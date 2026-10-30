import { readFile } from 'node:fs/promises';
import { z } from 'zod';

const pinnedImage = /^(?:[a-z0-9][a-z0-9._/-]*@)?sha256:[a-f0-9]{64}$/u;

export const runtimeManifestSchema = z
  .object({
    challengeId: z.uuid(),
    image: z.string().regex(pinnedImage, 'Runtime images must use a sha256 digest or image id'),
    containerPort: z.number().int().min(1).max(65_535),
    user: z.string().regex(/^[1-9][0-9]{0,9}:[1-9][0-9]{0,9}$/u),
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
      tmpfsMb: z.number().int().min(8).max(64),
    }).strict(),
  })
  .strict();

export type RuntimeManifest = z.infer<typeof runtimeManifestSchema>;

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
