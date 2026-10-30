// Builds the worker's runtime manifest from reviewed packages and observed image ids.
// Usage: node scripts/lab-manifests.mjs <images.json>  where images.json is {"<slug>": "sha256:..."}
import { readFile } from 'node:fs/promises';

const { loadChallengePackages } = await import('../dist/catalog/packages.js');
const { createWelcomeRuntimeManifest } = await import('../dist/catalog/welcome-runtime-manifest.js');
const { runtimeManifestSchema } = await import('../dist/orchestrator/runtime-manifests.js');

const raw = await readFile(process.argv[2], 'utf8');
const images = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);
const manifests = (await loadChallengePackages()).map((lab) => {
  const image = images[lab.slug];
  if (!image) throw new Error(`No image identity for ${lab.slug}`);
  return runtimeManifestSchema.parse({ ...lab.runtime, challengeId: lab.id, image });
});
if (images.welcome) manifests.push(createWelcomeRuntimeManifest(images.welcome));
process.stdout.write(`${JSON.stringify(manifests, null, 2)}\n`);
