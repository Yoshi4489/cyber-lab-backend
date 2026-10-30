// Benign solver: prints only the recovered flag, for the check harness.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const pcap = await readFile(join(process.env.ARTIFACTS, 'capture.pcap'));
const pending = new Map();
for (let offset = 24; offset < pcap.length;) {
  const length = pcap.readUInt32LE(offset + 8);
  const packet = pcap.subarray(offset + 16, offset + 16 + length);
  offset += 16 + length;
  const [sourcePort, destinationPort] = [packet.readUInt16BE(34), packet.readUInt16BE(36)];
  const text = packet.subarray(54).toString('latin1');
  const credential = /Authorization: Basic (\S+)/u.exec(text)?.[1];
  if (credential) pending.set(sourcePort, Buffer.from(credential, 'base64').toString());
  // The one login the server accepted is the one that matters.
  if (text.startsWith('HTTP/1.1 200') && pending.has(destinationPort)) {
    const decoded = pending.get(destinationPort);
    process.stdout.write(decoded.slice(decoded.indexOf(':') + 1));
    process.exit(0);
  }
}
process.exit(1);
