import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { z } from 'zod';
import { challengeDefinitionSchema, type ChallengeDefinition } from './definitions.js';
import { runtimeManifestSchema } from '../orchestrator/runtime-manifests.js';
import { writeArtifactManifest, type ArtifactFile } from '../services/artifact-store.js';

const POINTS_BY_DIFFICULTY = { easy: 100, medium: 250, hard: 500 } as const;

const packageDefinitionSchema = challengeDefinitionSchema
  .extend({
    objectives: z.array(z.string().trim().min(1).max(300)).min(1).max(10),
    learningOutcomes: z.array(z.string().trim().min(1).max(300)).min(1).max(10),
    references: z.array(z.object({
      label: z.string().trim().min(1).max(120),
      url: z.url().optional(),
    }).strict()).min(1).max(10),
    hints: z.array(z.object({
      bodyMd: z.string().trim().min(1).max(2_000),
      cost: z.number().int().positive(),
    }).strict()).min(1).max(5),
  })
  .strict()
  .superRefine((definition, context) => {
    if (definition.points !== POINTS_BY_DIFFICULTY[definition.difficulty]) {
      context.addIssue({ code: 'custom', message: 'Points must match the difficulty' });
    }
    if (definition.hints.reduce((total, hint) => total + hint.cost, 0) >= definition.points) {
      context.addIssue({ code: 'custom', message: 'Hint costs must stay below the challenge points' });
    }
  });

/** Runtime without the image: its digest is only known at deployment. */
export const packageRuntimeSchema = runtimeManifestSchema
  .omit({ image: true, challengeId: true })
  .strict()
  .refine(
    (runtime) => runtime.flagDelivery.mode === 'exec',
    'Real labs must not expose their flag through the container environment',
  );

export type ChallengePackage = ChallengeDefinition & {
  briefingMd: string;
  walkthroughMd: string;
  objectives: string[];
  learningOutcomes: string[];
  references: Array<{ label: string; url?: string | undefined }>;
  hints: Array<{ bodyMd: string; cost: number }>;
  /** Null for artifact challenges, which run nothing. */
  runtime: z.infer<typeof packageRuntimeSchema> | null;
};

export const CHALLENGES_DIRECTORY = fileURLToPath(new URL('../../challenges/', import.meta.url));
// `welcome` predates packages, and `_lab` is the shared runtime.
const NOT_PACKAGES = new Set(['_lab', 'welcome']);
const FLAG_LITERAL = /(?:FLAG|CTF)\{(?!\.\.\.\})/u;

export async function loadChallengePackages(directory = CHALLENGES_DIRECTORY): Promise<ChallengePackage[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch((error: unknown) => {
    // Runtime images ship without challenge sources; only seeding reads them.
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [];
    throw error;
  });
  const packages = await Promise.all(entries
    .filter((entry) => entry.isDirectory() && !NOT_PACKAGES.has(entry.name))
    .map((entry) => loadPackage(join(directory, entry.name), entry.name)));
  const ids = new Set(packages.map(({ id }) => id));
  if (ids.size !== packages.length) throw new Error('Challenge packages have duplicate ids');
  return packages.sort((left, right) => left.slug.localeCompare(right.slug));
}

async function loadPackage(path: string, folder: string): Promise<ChallengePackage> {
  const readText = (file: string) => readFile(join(path, file), 'utf8');
  const definition = packageDefinitionSchema.parse(JSON.parse(await readText('definition.json')));
  if (definition.slug !== folder) throw new Error(`Challenge folder ${folder} must match its slug`);
  const artifact = definition.kind === 'artifact';
  const runtime = artifact ? null : packageRuntimeSchema.parse(JSON.parse(await readText('runtime.json')));
  const generator = artifact ? await readText('generate.mjs') : '';
  const [briefingMd, walkthroughMd] = await Promise.all([readText('briefing.md'), readText('walkthrough.md')]);
  await readText('solve/solve.mjs');
  const published = [
    briefingMd,
    walkthroughMd,
    definition.summary,
    ...definition.hints.map(({ bodyMd }) => bodyMd),
    generator,
  ];
  if (published.some((text) => FLAG_LITERAL.test(text))) {
    throw new Error(`Challenge ${folder} must not publish a flag value`);
  }
  if (!briefingMd.trim() || !walkthroughMd.trim()) {
    throw new Error(`Challenge ${folder} needs a briefing and a walkthrough`);
  }
  return { ...definition, briefingMd, walkthroughMd, runtime };
}

/** Runs a reviewed generator. Called only by the operator build and the publication check. */
export async function buildArtifacts(lab: ChallengePackage, flag: string, directory: string): Promise<ArtifactFile[]> {
  if (lab.kind !== 'artifact') throw new Error(`${lab.slug} is not an artifact challenge`);
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  const url = pathToFileURL(join(CHALLENGES_DIRECTORY, lab.slug, 'generate.mjs')).href;
  const { generate } = await import(url) as { generate: (input: { flag: string; outDir: string }) => Promise<void> };
  await generate({ flag, outDir: directory });
  return writeArtifactManifest(directory);
}
