// Publication gate for artifact challenges: builds with a throwaway flag, proves the solver
// recovers it, and proves it can't be found by searching the files. Prints outcomes only.
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const { buildArtifacts, CHALLENGES_DIRECTORY, loadChallengePackages } = await import('../dist/catalog/packages.js');

let failures = 0;
const check = (slug, name, ok) => {
  if (!ok) failures += 1;
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'} ${slug}: ${name}\n`);
};

for (const lab of await loadChallengePackages()) {
  if (lab.kind !== 'artifact') continue;
  const directory = await mkdtemp(join(tmpdir(), 'artifact-check-'));
  const flag = `CTF{v1_${randomBytes(32).toString('base64url')}}`;
  try {
    await buildArtifacts(lab, flag, directory);
    const { stdout } = await promisify(execFile)(process.execPath, [join(CHALLENGES_DIRECTORY, lab.slug, 'solve/solve.mjs')], {
      env: { ...process.env, ARTIFACTS: directory },
    });
    check(lab.slug, 'solver recovers the exact flag', stdout === flag);
    const contents = await Promise.all((await readdir(directory)).map((name) => readFile(join(directory, name))));
    check(lab.slug, 'flag is not in the files as plain text', !contents.some((bytes) => bytes.includes(flag)));
    const another = await mkdtemp(join(tmpdir(), 'artifact-check-'));
    await buildArtifacts(lab, `CTF{v1_${randomBytes(32).toString('base64url')}}`, another);
    const { stdout: other } = await promisify(execFile)(process.execPath, [join(CHALLENGES_DIRECTORY, lab.slug, 'solve/solve.mjs')], {
      env: { ...process.env, ARTIFACTS: another },
    });
    check(lab.slug, 'solver depends on the files, not a fixed answer', other !== flag);
    await rm(another, { recursive: true, force: true });
  } catch (error) {
    check(lab.slug, `harness error: ${String(error.message).replaceAll(flag, '<flag>').slice(0, 200)}`, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
process.stdout.write(failures ? `${failures} checks failed\n` : 'all checks passed\n');
process.exit(failures ? 1 : 0);
