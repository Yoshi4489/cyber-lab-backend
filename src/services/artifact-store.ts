import { createHash } from 'node:crypto';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

export const ARTIFACT_FILENAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/u;
const MANIFEST = 'manifest.json';
export const MAX_ARTIFACT_BYTES = 20 * 1024 * 1024;

const manifestSchema = z.object({
  files: z.array(z.object({
    filename: z.string().regex(ARTIFACT_FILENAME),
    sizeBytes: z.number().int().nonnegative().max(MAX_ARTIFACT_BYTES),
    sha256: z.string().regex(/^[0-9a-f]{64}$/u),
  }).strict()),
}).strict();

export type ArtifactFile = z.infer<typeof manifestSchema>['files'][number];

export type ArtifactStore = {
  list: (slug: string, version: number) => Promise<ArtifactFile[]>;
  /** Null when the file is not in the manifest. Throws when stored bytes fail their checksum. */
  read: (slug: string, version: number, filename: string) => Promise<Buffer | null>;
};

export const emptyArtifactStore: ArtifactStore = {
  list: async () => [],
  read: async () => null,
};

/** Files live outside Git because they contain flags. Paths come only from validated names. */
export class LocalArtifactStore implements ArtifactStore {
  constructor(private readonly root: string) {}

  async list(slug: string, version: number): Promise<ArtifactFile[]> {
    const raw = await readFile(join(this.directory(slug, version), MANIFEST), 'utf8').catch((error: unknown) => {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
      throw error;
    });
    return raw === null ? [] : manifestSchema.parse(JSON.parse(raw)).files;
  }

  async read(slug: string, version: number, filename: string): Promise<Buffer | null> {
    const file = (await this.list(slug, version)).find((entry) => entry.filename === filename);
    if (!file) return null;
    const bytes = await readFile(join(this.directory(slug, version), file.filename));
    if (createHash('sha256').update(bytes).digest('hex') !== file.sha256) {
      throw new Error('Stored artifact failed its checksum');
    }
    return bytes;
  }

  private directory(slug: string, version: number): string {
    if (!/^[a-z0-9-]{1,64}$/u.test(slug) || !Number.isInteger(version)) throw new Error('Invalid artifact location');
    return join(this.root, slug, `v${version}`);
  }
}

/** Operator build only: records what a generator wrote, refusing anything the store would not serve. */
export async function writeArtifactManifest(directory: string): Promise<ArtifactFile[]> {
  const files: ArtifactFile[] = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isFile() || !ARTIFACT_FILENAME.test(entry.name)) throw new Error(`Invalid artifact name: ${entry.name}`);
    const path = join(directory, entry.name);
    const { size } = await stat(path);
    if (size > MAX_ARTIFACT_BYTES) throw new Error(`Artifact too large: ${entry.name}`);
    files.push({ filename: entry.name, sizeBytes: size, sha256: createHash('sha256').update(await readFile(path)).digest('hex') });
  }
  if (files.length === 0) throw new Error('Generator wrote no artifacts');
  await writeFile(join(directory, MANIFEST), JSON.stringify({ files }, null, 2));
  return files;
}
