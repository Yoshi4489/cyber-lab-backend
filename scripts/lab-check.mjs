// Publication gate: builds each lab, starts it through the real DockerOrchestrator,
// proves its solver works, and proves known shortcuts don't reveal the flag.
// Prints outcomes only, never a flag.
// Point DOCKER_HOST at the isolated lab Engine, or run on a disposable CI runner.
// Never run this against a control-plane Docker host.
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import Docker from 'dockerode';

const { CHALLENGES_DIRECTORY, loadChallengePackages } = await import('../dist/catalog/packages.js');
const { DockerOrchestrator } = await import('../dist/orchestrator/docker-adapter.js');
const { runtimeManifestSchema } = await import('../dist/orchestrator/runtime-manifests.js');

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
// Checks need no ingress: routes go to an in-memory router and solvers use the instance network.
const router = {
  upsert: async () => undefined,
  remove: async () => undefined,
  listInstanceIds: async () => [],
  validateManagedRoute: async () => undefined,
};
// CI runners lack userns remap; the lab Engine keeps the full host check.
const orchestrator = new DockerOrchestrator(new Docker(), router, undefined, {
  verifyHost: process.env.LAB_CHECK_VERIFY_HOST !== 'false',
});
const only = new Set(process.argv.slice(2));
const images = {};
const imageId = (slug, dockerfile, tag) => {
  // An offline lab Engine can't resolve the pinned base; there, load prebuilt images first.
  if (process.env.LAB_CHECK_PREBUILT !== 'true') {
    docker(['build', '--pull=false', '-q', '-t', tag, '-f', join(CHALLENGES_DIRECTORY, slug, dockerfile), CHALLENGES_DIRECTORY]);
  }
  return docker(['image', 'inspect', tag, '--format', '{{.Id}}']);
};

const verifyHost = process.env.LAB_CHECK_VERIFY_HOST !== 'false';
for (const lab of await loadChallengePackages()) {
  if (!lab.runtime || (only.size && !only.has(lab.slug))) continue;
  if (lab.runtime.sandbox === 'gvisor' && !verifyHost) {
    // CI runners have no gVisor runtime; these labs are checked on the lab VM instead.
    process.stdout.write(`SKIP ${lab.slug}: needs the gVisor runtime, which this host lacks\n`);
    continue;
  }
  const shell = lab.kind === 'shell';
  const instanceId = randomUUID();
  const suffix = instanceId.replaceAll('-', '');
  const flag = `CTF{v1_${randomBytes(32).toString('base64url')}}`;
  let spawned = null;
  try {
    const tag = `cyber-range-lab-${lab.slug}:check`;
    images[lab.slug] = imageId(lab.slug, 'Dockerfile', tag);
    const services = lab.runtime.services.map((service) => {
      const key = `${lab.slug}/${service.name}`;
      images[key] = imageId(lab.slug, `${service.name}.Dockerfile`, `cyber-range-lab-${lab.slug}-${service.name}:check`);
      return { ...service, image: images[key] };
    });
    const manifest = runtimeManifestSchema.parse({ ...lab.runtime, services, challengeId: lab.id, image: images[lab.slug] });
    // Spawn waits for every container's healthcheck, with production options and flag delivery.
    spawned = await orchestrator.spawn({
      instanceId, challengeId: lab.id, routeKey: randomBytes(20).toString('hex'), flag, manifest,
    });
    check(lab.slug, 'starts healthy through the orchestrator', true);

    const leaks = (args) => attempt(args).out.includes(flag);
    const escalation = manifest.privilege === 'escalation';
    if (escalation) {
      // Escalation labs are solved inside the learner's own container, as the learner.
      const solver = await readFile(join(CHALLENGES_DIRECTORY, lab.slug, 'solve/solve.py'), 'utf8');
      const solved = attempt(['exec', '-i', '-u', manifest.user, `cr-${suffix}`, 'python3', '-'], { input: solver });
      check(lab.slug, 'solver recovers the exact flag', solved.code === 0 && solved.out === flag);
      // The profile relaxes no-new-privileges only: the capability bounding set must stay empty.
      const status = attempt(['exec', '-u', manifest.user, `cr-${suffix}`, 'grep', '-E', '^(CapBnd|CapEff|NoNewPrivs):', '/proc/self/status']).out;
      check(lab.slug, 'entry keeps an empty capability set', /CapBnd:\s+0+\b/u.test(status) && /CapEff:\s+0+\b/u.test(status));
      check(lab.slug, 'entry runs without no-new-privileges', /NoNewPrivs:\s+0\b/u.test(status));
    } else if (shell) {
      // A shell lab is exploited from the workstation against the target service; the solver
      // reaches it through a hosts entry, since gVisor can't use Docker's embedded DNS.
      const hosts = manifest.services.flatMap((service) => {
        const address = attempt(['inspect', `cr-${suffix}-${service.name}`, '--format',
          `{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}`]).out;
        return ['--add-host', `${service.name}:${address}`];
      });
      const solver = await readFile(join(CHALLENGES_DIRECTORY, lab.slug, 'solve/solve.py'), 'utf8');
      const solved = attempt(['run', '-i', '--rm', '--runtime', 'runsc', '--network', `crn-${suffix}`,
        '--read-only', '--cap-drop', 'ALL', '--tmpfs', '/tmp:rw,size=64m', '-e', 'HOME=/tmp', ...hosts,
        tag, 'python3', '-'], { input: solver });
      check(lab.slug, 'solver recovers the exact flag', solved.code === 0 && solved.out === flag);
    } else {
      const solver = await readFile(join(CHALLENGES_DIRECTORY, lab.slug, 'solve/solve.mjs'), 'utf8');
      const solved = attempt(['run', '-i', '--rm', '--network', `crn-${suffix}`, '--read-only', '--cap-drop', 'ALL',
        '-e', `TARGET=http://app:${manifest.containerPort}/`, tag,
        'node', '--input-type=module', '-'], { input: solver });
      check(lab.slug, 'solver recovers the exact flag', solved.code === 0 && solved.out === flag);
    }

    const delivery = manifest.flagDelivery;
    const holder = delivery.mode === 'exec' && delivery.service ? `cr-${suffix}-${delivery.service}` : `cr-${suffix}`;
    for (const name of [`cr-${suffix}`, ...manifest.services.map((service) => `cr-${suffix}-${service.name}`)]) {
      const where = name === `cr-${suffix}` ? 'entry' : name.slice(`cr-${suffix}-`.length);
      check(lab.slug, `${where}: flag is absent from the container config`, !leaks(['inspect', name]));
      check(lab.slug, `${where}: flag is absent from every process environment`,
        !leaks(['exec', name, 'sh', '-c', 'for p in /proc/[0-9]*; do cat $p/environ 2>/dev/null; done']));
      check(lab.slug, `${where}: flag is absent from the image`,
        !leaks(['exec', name, 'sh', '-c', `grep -rl ${JSON.stringify(flag)} /app /opt 2>/dev/null || true`]));
    }
    // The internal network is default-deny; probe egress from the entry with whatever it ships.
    const egress = shell
      ? attempt(['exec', `cr-${suffix}`, 'python3', '-c',
          'import socket,sys;\nsys.exit(0 if __import__("socket").create_connection(("1.1.1.1",80),3) else 1)'])
      : attempt(['exec', `cr-${suffix}`, 'node', '-e',
          "fetch('http://1.1.1.1',{signal:AbortSignal.timeout(3000)}).then(()=>process.exit(0),()=>process.exit(1))"]);
    check(lab.slug, 'entry has no outbound network', egress.code !== 0);
    if (escalation) {
      // The flag is on this container but owned by another account: the learner can't read it directly.
      check(lab.slug, 'learner cannot read the flag without the flaw', !leaks(['exec', '-u', manifest.user, `cr-${suffix}`, 'sh', '-c',
        `grep -rs ${JSON.stringify(flag)} /home /tmp /opt /var /srv /etc 2>/dev/null || true`]));
    } else if (shell) {
      // The flag lives only in the target service; the learner reaches it through the exploit,
      // never from their own container's disk.
      check(lab.slug, 'flag is not stored on the workstation', !leaks(['exec', `cr-${suffix}`, 'sh', '-c',
        `grep -rl ${JSON.stringify(flag)} /home /tmp /opt 2>/dev/null || true`]));
      check(lab.slug, 'standard shell lab keeps no-new-privileges', /NoNewPrivs:\s+1\b/u.test(
        attempt(['exec', `cr-${suffix}`, 'grep', '^NoNewPrivs:', '/proc/self/status']).out));
    } else {
      check(lab.slug, 'delivery file is gone', attempt(['exec', holder, 'test', '-e', '/tmp/.cr-flag']).code !== 0);
    }
  } catch (error) {
    check(lab.slug, `harness error: ${String(error.stderr ?? error.message).replaceAll(flag, '<flag>').slice(0, 300)}`, false);
  } finally {
    // Spawn removes its own partial resources on failure; destroy covers the rest.
    await orchestrator.destroy({ instanceId, containerId: spawned?.containerId ?? null, networkId: spawned?.networkId ?? null })
      .catch(() => undefined);
    const left = attempt(['ps', '-aq', '--filter', `label=cyber-range.instance-id=${instanceId}`]).out
      + attempt(['network', 'ls', '-q', '--filter', `label=cyber-range.instance-id=${instanceId}`]).out;
    check(lab.slug, 'cleanup leaves no containers or networks', left === '');
  }
}
process.stdout.write(`IMAGES ${JSON.stringify(images)}\n`);
process.stdout.write(failures ? `${failures} checks failed\n` : 'all checks passed\n');
process.exit(failures ? 1 : 0);
