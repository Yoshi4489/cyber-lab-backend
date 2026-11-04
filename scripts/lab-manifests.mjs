// Builds the worker's runtime manifest from reviewed packages and observed image ids.
// Usage: node scripts/lab-manifests.mjs <images.json>  where images.json maps "<slug>" and "<slug>/<service>" to "sha256:..."
import { readFile } from 'node:fs/promises';

const { loadChallengePackages } = await import('../dist/catalog/packages.js');
const { createWelcomeRuntimeManifest } = await import('../dist/catalog/welcome-runtime-manifest.js');
const { runtimeManifestSchema } = await import('../dist/orchestrator/runtime-manifests.js');

const raw = await readFile(process.argv[2], 'utf8');
const images = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);
const manifests = (await loadChallengePackages()).filter((lab) => lab.runtime).map((lab) => {
  const image = images[lab.slug];
  if (!image) throw new Error(`No image identity for ${lab.slug}`);
  const services = lab.runtime.services.map((service) => {
    const serviceImage = images[`${lab.slug}/${service.name}`];
    if (!serviceImage) throw new Error(`No image identity for ${lab.slug}/${service.name}`);
    return { ...service, image: serviceImage };
  });
  return runtimeManifestSchema.parse({ ...lab.runtime, services, challengeId: lab.id, image });
});
if (images.welcome) manifests.push(createWelcomeRuntimeManifest(images.welcome));
process.stdout.write(`${JSON.stringify(manifests, null, 2)}\n`);
