import { readFile } from 'node:fs/promises';
import { z } from 'zod';

const pinnedImage = z.string().regex(
  /^(?:[a-z0-9][a-z0-9._/-]*@)?sha256:[a-f0-9]{64}$/u,
  'Runtime images must use a sha256 digest or image id',
);
const userId = z.string().regex(/^[1-9][0-9]{0,9}:[1-9][0-9]{0,9}$/u);

// Shared by the entry container and every internal service: the same fixed defaults apply to all.
const containerFields = {
  user: userId,
  command: z.array(z.string().min(1).max(512)).min(1).max(32).optional(),
  healthcheck: z.object({
    test: z.array(z.string().min(1).max(512)).min(2).max(16)
      .refine((test) => test[0] === 'CMD' || test[0] === 'CMD-SHELL', {
        message: 'Healthcheck must use Docker CMD or CMD-SHELL form',
      }),
    intervalSeconds: z.number().int().min(1).max(30).default(5),
    timeoutSeconds: z.number().int().min(1).max(10).default(3),
    retries: z.number().int().min(1).max(10).default(5),
    startupSeconds: z.number().int().min(5).max(120).default(60),
  }).strict(),
  resources: z.object({
    memoryMb: z.number().int().min(32).max(1_024),
    cpuCores: z.number().min(0.1).max(2),
    pids: z.number().int().min(16).max(256),
    tmpfsMb: z.number().int().min(8).max(128),
  }).strict(),
  // An exec-capable scratch mount, for the one container where a learner builds and runs code.
  // `/tmp` stays noexec; this is size-bounded, nosuid and nodev, and used only by shell labs.
  workspace: z.object({
    path: z.string().regex(/^\/[A-Za-z0-9_][A-Za-z0-9_./-]{1,62}$/u),
    sizeMb: z.number().int().min(8).max(256),
  }).strict().optional(),
};

/** Internal services sit on the instance network only: no route, no published port. */
export const serviceBaseSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9]{1,15}$/u).refine((name) => name !== 'app', 'The entry service is named app'),
  ...containerFields,
}).strict();

export const runtimeManifestObject = z.object({
  challengeId: z.uuid(),
  image: pinnedImage,
  containerPort: z.number().int().min(1).max(65_535),
  ...containerFields,
  // `env` persists in the container config and /proc; real labs use `exec`.
  flagDelivery: z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('env') }).strict(),
    z.object({
      mode: z.literal('exec'),
      command: z.array(z.string().min(1).max(512)).min(1).max(8),
      user: userId,
      /** Which container receives the flag; the entry when omitted. */
      service: z.string().optional(),
    }).strict(),
  ]).default({ mode: 'env' }),
  services: z.array(serviceBaseSchema.extend({ image: pinnedImage }).strict()).max(3).default([]),
  /** Capacity cost relative to a one-container lab. */
  slotWeight: z.number().int().min(1).max(8).default(1),
  // `gvisor` runs every container of the lab on the runsc kernel, for labs that give learners a shell.
  // It needs a host that advertises the runtime; the worker's preflight checks that.
  sandbox: z.enum(['runc', 'gvisor']).default('runc'),
  // `escalation` lets set-uid work in the entry container (no `no-new-privileges`, set-uid-honouring
  // gVisor runtime). Capabilities stay dropped. Only reviewed labs in ESCALATION_LABS may use it.
  privilege: z.enum(['standard', 'escalation']).default('standard'),
}).strict();

/** Reviewed privilege-escalation labs. Adding one is a security-reviewed code change. */
export const ESCALATION_LABS: ReadonlySet<string> = new Set([
  'a5000000-0000-4000-8000-000000000001', // SUID Surprise
  'a5000000-0000-4000-8000-000000000002', // Cron Mischief
  'a5000000-0000-4000-8000-000000000003', // Sudo Slip
]);

/** Null when the manifest's privilege profile is allowed for this challenge. */
export function escalationProblem(challengeId: string, manifest: { privilege: string; sandbox: string }): string | null {
  if (manifest.privilege !== 'escalation') return null;
  if (manifest.sandbox !== 'gvisor') return 'The escalation profile requires the gVisor sandbox';
  if (!ESCALATION_LABS.has(challengeId)) return 'The escalation profile is limited to reviewed labs';
  return null;
}

export function checkServices(
  manifest: { services: ReadonlyArray<{ name: string }>; flagDelivery: { mode: string; service?: string | undefined } },
  context: z.RefinementCtx,
): void {
  const names = manifest.services.map(({ name }) => name);
  if (new Set(names).size !== names.length) context.addIssue({ code: 'custom', message: 'Service names must be unique' });
  const target = manifest.flagDelivery.mode === 'exec' ? manifest.flagDelivery.service : undefined;
  if (target !== undefined && !names.includes(target)) {
    context.addIssue({ code: 'custom', message: 'Flag delivery names an unknown service' });
  }
}

export const runtimeManifestSchema = runtimeManifestObject.superRefine((manifest, context) => {
  checkServices(manifest, context);
  const problem = escalationProblem(manifest.challengeId, manifest);
  if (problem) context.addIssue({ code: 'custom', message: problem });
});

export type RuntimeManifest = z.infer<typeof runtimeManifestSchema>;
export type RuntimeService = RuntimeManifest['services'][number];

export class RuntimeManifestRegistry {
  private readonly byChallengeId: ReadonlyMap<string, RuntimeManifest>;

  constructor(manifests: readonly unknown[]) {
    const parsed = z.array(runtimeManifestSchema).parse(manifests);
    const byChallengeId = new Map<string, RuntimeManifest>();
    for (const manifest of parsed) {
      if (byChallengeId.has(manifest.challengeId)) {
        throw new Error(`Duplicate runtime manifest for challenge ${manifest.challengeId}`);
      }
      byChallengeId.set(manifest.challengeId, manifest);
    }
    this.byChallengeId = byChallengeId;
  }

  get(challengeId: string): RuntimeManifest | null {
    return this.byChallengeId.get(challengeId) ?? null;
  }

  all(): readonly RuntimeManifest[] {
    return [...this.byChallengeId.values()];
  }
}

export async function loadRuntimeManifestRegistry(path: string): Promise<RuntimeManifestRegistry> {
  const contents = await readFile(path, 'utf8');
  return new RuntimeManifestRegistry(JSON.parse(contents.replace(/^\uFEFF/u, '')) as unknown[]);
}
