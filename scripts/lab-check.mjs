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

for (const lab of await loadChallengePackages()) {
  if (!lab.runtime || (only.size && !only.has(lab.slug))) continue;
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

    const solver = await readFile(join(CHALLENGES_DIRECTORY, lab.slug, 'solve/solve.mjs'), 'utf8');
    const solved = attempt(['run', '-i', '--rm', '--network', `crn-${suffix}`, '--read-only', '--cap-drop', 'ALL',
      '-e', `TARGET=http://app:${manifest.containerPort}/`, tag,
      'node', '--input-type=module', '-'], { input: solver });
    check(lab.slug, 'solver recovers the exact flag', solved.code === 0 && solved.out === flag);

    const leaks = (args) => attempt(args).out.includes(flag);
    const delivery = manifest.flagDelivery;
    const holder = delivery.mode === 'exec' && delivery.service ? `cr-${suffix}-${delivery.service}` : `cr-${suffix}`;
    for (const name of [`cr-${suffix}`, ...manifest.services.map((service) => `cr-${suffix}-${service.name}`)]) {
      const where = name === `cr-${suffix}` ? 'app' : name.slice(`cr-${suffix}-`.length);
      check(lab.slug, `${where}: flag is absent from the container config`, !leaks(['inspect', name]));
      check(lab.slug, `${where}: flag is absent from every process environment`,
        !leaks(['exec', name, 'sh', '-c', 'for p in /proc/[0-9]*; do cat $p/environ 2>/dev/null; done']));
      check(lab.slug, `${where}: flag is absent from the image`, !leaks(['exec', name, 'grep', '-rl', flag, '/app']));
      check(lab.slug, `${where}: no outbound network`, attempt(['exec', name, 'node', '-e',
        "fetch('http://1.1.1.1',{signal:AbortSignal.timeout(3000)}).then(()=>process.exit(0),()=>process.exit(1))"]).code !== 0);
    }
    check(lab.slug, 'delivery file is gone', attempt(['exec', holder, 'test', '-e', '/tmp/.cr-flag']).code !== 0);
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
