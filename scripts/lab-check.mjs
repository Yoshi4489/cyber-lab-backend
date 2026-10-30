// Publication gate: builds each lab, proves its solver works, and proves known
// shortcuts don't reveal the flag. Prints outcomes only, never a flag.
// Point DOCKER_HOST at the isolated lab Engine, or run on a disposable CI runner.
// Never run this against a control-plane Docker host.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const { CHALLENGES_DIRECTORY, loadChallengePackages } = await import('../dist/catalog/packages.js');

const docker = (args, options = {}) => execFileSync('docker', args, {
  encoding: 'utf8',
  stdio: ['pipe', 'pipe', 'pipe'],
  ...options,
}).trim();
const attempt = (args, options) => {
  try {
    return { code: 0, out: docker(args, options) };
  } catch (error) {
    return { code: error.status ?? 1, out: `${error.stdout ?? ''}` };
  }
};
let failures = 0;
const check = (slug, name, ok) => {
  if (!ok) failures += 1;
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'} ${slug}: ${name}\n`);
};
const only = new Set(process.argv.slice(2));
const images = {};

for (const lab of await loadChallengePackages()) {
  if (!lab.runtime || (only.size && !only.has(lab.slug))) continue;
  const tag = `cyber-range-lab-${lab.slug}:check`;
  const suffix = randomBytes(6).toString('hex');
  const network = `labcheck-${suffix}`;
  const target = `labcheck-t-${suffix}`;
  const flag = `CTF{v1_${randomBytes(32).toString('base64url')}}`;
  try {
    // An offline lab Engine can't resolve the pinned base; there, load prebuilt images first.
    if (process.env.LAB_CHECK_PREBUILT !== 'true') {
      docker(['build', '--pull=false', '-q', '-t', tag, '-f', join(CHALLENGES_DIRECTORY, lab.slug, 'Dockerfile'), CHALLENGES_DIRECTORY]);
    }
    images[lab.slug] = docker(['image', 'inspect', tag, '--format', '{{.Id}}']);
    docker(['network', 'create', '--internal', network]);
    // Same restrictions as `buildContainerOptions`, so a pass here reflects production limits.
    docker(['run', '-d', '--name', target, '--network', network, '--user', lab.runtime.user,
      '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '--init',
      '--memory', `${lab.runtime.resources.memoryMb}m`, '--memory-swap', `${lab.runtime.resources.memoryMb}m`,
      '--cpus', String(lab.runtime.resources.cpuCores), '--pids-limit', String(lab.runtime.resources.pids),
      '--ipc', 'none', '--tmpfs', `/tmp:rw,noexec,nosuid,nodev,size=${lab.runtime.resources.tmpfsMb}m`, tag]);
    const delivery = lab.runtime.flagDelivery;
    docker(['exec', '-e', `CYBER_RANGE_FLAG=${flag}`, '--user', delivery.user, target, ...delivery.command]);
    let healthy = false;
    for (let index = 0; index < 60 && !healthy; index += 1) {
      healthy = attempt(['inspect', target, '--format', '{{.State.Health.Status}}']).out === 'healthy';
      if (!healthy) await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    check(lab.slug, 'becomes healthy under runtime limits', healthy);

    const solver = await readFile(join(CHALLENGES_DIRECTORY, lab.slug, 'solve/solve.mjs'), 'utf8');
    const solved = attempt(['run', '-i', '--rm', '--network', network, '--read-only', '--cap-drop', 'ALL',
      '-e', `TARGET=http://${target}:${lab.runtime.containerPort}/`, tag,
      'node', '--input-type=module', '-'], { input: solver });
    check(lab.slug, 'solver recovers the exact flag', solved.code === 0 && solved.out === flag);

    const leaks = (args) => attempt(args).out.includes(flag);
    check(lab.slug, 'flag is absent from the container config', !leaks(['inspect', target]));
    check(lab.slug, 'flag is absent from PID 1 environment', !leaks(['exec', target, 'sh', '-c', 'cat /proc/1/environ; cat /proc/self/environ']));
    check(lab.slug, 'flag is absent from the server environment', !leaks(['exec', target, 'sh', '-c', 'for p in /proc/[0-9]*; do cat $p/environ 2>/dev/null; done']));
    check(lab.slug, 'delivery file is gone', attempt(['exec', target, 'test', '-e', '/tmp/.cr-flag']).code !== 0);
    check(lab.slug, 'flag is absent from the image', !leaks(['exec', target, 'grep', '-rl', flag, '/app']));
    check(lab.slug, 'lab has no outbound network', attempt(['exec', target, 'node', '-e',
      "fetch('http://1.1.1.1',{signal:AbortSignal.timeout(3000)}).then(()=>process.exit(0),()=>process.exit(1))"]).code !== 0);
  } catch (error) {
    check(lab.slug, `harness error: ${String(error.stderr ?? error.message).replaceAll(flag, '<flag>').slice(0, 300)}`, false);
  } finally {
    attempt(['rm', '-f', target]);
    attempt(['network', 'rm', network]);
  }
}
process.stdout.write(`IMAGES ${JSON.stringify(images)}\n`);
process.stdout.write(failures ? `${failures} checks failed\n` : 'all checks passed\n');
process.exit(failures ? 1 : 0);
