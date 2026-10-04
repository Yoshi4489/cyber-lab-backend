// Run only inside the disposable Phase 4 target:
//
//   docker exec \
//     -e PHASE4_TARGETS="dockerApiBridge=172.17.0.1:2376,dockerApiHostOnly=192.168.56.106:2376,controlPlanePostgres=192.168.56.107:5432,controlPlaneRedis=192.168.56.107:6379,controlPlaneSsh=192.168.56.107:22" \
//     -i TARGET node --input-type=module < scripts/phase4-probe.mjs
//
// An internal Docker network gives the target no default route, so every
// off-subnet destination returns ENETUNREACH whether or not anything listens
// there. That is the property under test, and it is why any other outcome
// fails: ECONNREFUSED or a completed connection both mean a route exists.
//
// To rule out a vacuous result, confirm from the target HOST that each
// supplied address is reachable there before running this. If the host cannot
// reach the control plane either, the target's ENETUNREACH says nothing about
// container isolation specifically.
import { strict as assert } from 'node:assert';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { connect } from 'node:net';

const status = await readFile('/proc/self/status', 'utf8');
const fields = Object.fromEntries(
  ['Uid', 'CapEff', 'NoNewPrivs', 'Seccomp'].map((key) => [
    key,
    status.match(new RegExp(`^${key}:\\s*(.+)$`, 'mu'))?.[1] ?? 'missing',
  ]),
);

async function canWrite(path) {
  try {
    await writeFile(path, 'phase4-disposable-check');
    await unlink(path);
    return true;
  } catch {
    return false;
  }
}

async function canConnect(host, port) {
  return new Promise((resolve) => {
    // An absent address on the local bridge may need an ARP timeout before
    // Linux reports EHOSTUNREACH. A short timer would hide that result.
    const socket = connect({ host, port, timeout: 10000 });
    socket.once('connect', () => { socket.destroy(); resolve('connected'); });
    socket.once('timeout', () => { socket.destroy(); resolve('timeout'); });
    socket.once('error', (error) => resolve(error.code ?? 'error'));
  });
}

// A public resolver and the cloud metadata address exist on every network this
// could run on, so they need no topology knowledge to be meaningful.
const builtIn = {
  publicIpv4: ['1.1.1.1', 80],
  cloudMetadata: ['169.254.169.254', 80],
};

// Control-plane and Docker API addresses are deliberately not defaulted. A
// stale default still detects a route, but it records the wrong topology in the
// evidence and can probe a port the Docker API no longer uses.
function parseTargets(spec) {
  const entries = spec.split(',').map((part) => part.trim()).filter(Boolean);
  if (entries.length === 0) throw new Error('PHASE4_TARGETS listed no addresses');
  const seen = new Set(Object.keys(builtIn));
  return Object.fromEntries(entries.map((entry) => {
    const match = /^([A-Za-z][A-Za-z0-9]*)=((?:\d{1,3}\.){3}\d{1,3}):(\d{1,5})$/u.exec(entry);
    if (!match) throw new Error(`Invalid PHASE4_TARGETS entry: ${entry}`);
    const [, name, host, rawPort] = match;
    if (seen.has(name)) throw new Error(`Duplicate PHASE4_TARGETS name: ${name}`);
    seen.add(name);
    if (host.split('.').some((octet) => Number(octet) > 255)) {
      throw new Error(`Invalid address in PHASE4_TARGETS entry: ${entry}`);
    }
    const port = Number(rawPort);
    if (port < 1 || port > 65_535) throw new Error(`Invalid port in PHASE4_TARGETS entry: ${entry}`);
    return [name, [host, port]];
  }));
}

if (!process.env.PHASE4_TARGETS) {
  throw new Error(
    'Set PHASE4_TARGETS to this topology\'s control-plane and Docker API addresses, as ' +
    'name=host:port pairs separated by commas. Confirm each address is reachable from the ' +
    'target host first, or an unreachable result proves nothing about container isolation.',
  );
}
const endpoints = { ...builtIn, ...parseTargets(process.env.PHASE4_TARGETS) };

const connections = Object.fromEntries(await Promise.all(
  Object.entries(endpoints).map(async ([name, [host, port]]) => [
    name,
    await canConnect(host, port),
  ]),
));

const result = {
  fields,
  rootWritable: await canWrite('/app/phase4-check'),
  tmpWritable: await canWrite('/tmp/phase4-check'),
  // Recorded so the evidence states which addresses were asserted, rather than
  // leaving a reader to infer them from whichever revision was committed.
  probed: Object.fromEntries(
    Object.entries(endpoints).map(([name, [host, port]]) => [name, `${host}:${port}`]),
  ),
  connections,
};
process.stdout.write(`${JSON.stringify(result)}\n`);
assert.match(fields.Uid, /^65532\s/u);
assert.equal(fields.CapEff, '0000000000000000');
assert.equal(fields.NoNewPrivs, '1');
assert.equal(fields.Seccomp, '2');
assert.equal(result.rootWritable, false);
assert.equal(result.tmpWritable, true);
for (const [name, outcome] of Object.entries(connections)) {
  assert.ok(
    ['ENETUNREACH', 'EHOSTUNREACH'].includes(outcome),
    `${name} (${result.probed[name]}) returned ${outcome}; only a missing route passes`,
  );
}
