// Run only inside the disposable Phase 4 target with: docker exec -i TARGET node < phase4-probe.mjs
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
    const socket = connect({ host, port, timeout: 1500 });
    socket.once('connect', () => { socket.destroy(); resolve('connected'); });
    socket.once('timeout', () => { socket.destroy(); resolve('timeout'); });
    socket.once('error', (error) => resolve(error.code ?? 'error'));
  });
}

const endpoints = {
  publicIpv4: ['1.1.1.1', 80],
  cloudMetadata: ['169.254.169.254', 80],
  privateHost: ['10.0.2.15', 5432],
  dockerGateway: ['172.17.0.1', 2375],
};
const peerIp = process.argv[2];
if (peerIp) {
  if (!/^(?:\d{1,3}\.){3}\d{1,3}$/u.test(peerIp)) throw new Error('Invalid peer IPv4 address');
  endpoints.separateNetworkPeer = [peerIp, 80];
}
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
  connections,
};
process.stdout.write(`${JSON.stringify(result)}\n`);
assert.match(fields.Uid, /^65532\s/u);
assert.equal(fields.CapEff, '0000000000000000');
assert.equal(fields.NoNewPrivs, '1');
assert.equal(fields.Seccomp, '2');
assert.equal(result.rootWritable, false);
assert.equal(result.tmpWritable, true);
for (const outcome of Object.values(connections)) {
  assert.ok(['ENETUNREACH', 'EHOSTUNREACH'].includes(outcome), `Unexpected route result: ${outcome}`);
}
