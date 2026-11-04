// Operator build: generates artifact challenge files, with derived flags, into the store outside Git.
// Usage: INSTANCE_FLAG_SECRET=... ARTIFACT_STORE_DIRECTORY=... node scripts/build-artifacts.mjs
// Prints file names and sizes only, never a flag.
import { join } from 'node:path';

const { buildArtifacts, loadChallengePackages } = await import('../dist/catalog/packages.js');
const { deriveArtifactFlag } = await import('../dist/services/instance-flags.js');

const { INSTANCE_FLAG_SECRET: secret, ARTIFACT_STORE_DIRECTORY: root } = process.env;
if (!secret || !root) throw new Error('INSTANCE_FLAG_SECRET and ARTIFACT_STORE_DIRECTORY are required');

for (const lab of await loadChallengePackages()) {
  if (lab.kind !== 'artifact') continue;
  const version = lab.definitionVersion;
  const flag = deriveArtifactFlag(secret, { challengeId: lab.id, version });
  const files = await buildArtifacts(lab, flag, join(root, lab.slug, `v${version}`));
  for (const file of files) process.stdout.write(`${lab.slug} v${version} ${file.filename} ${file.sizeBytes} bytes\n`);
}
