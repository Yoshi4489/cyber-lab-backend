import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const CLIENT = [10, 20, 0, 15];
const SERVER = [10, 20, 0, 5];

function checksum(bytes) {
  let sum = 0;
  for (let index = 0; index < bytes.length; index += 2) sum += (bytes[index] << 8) + (bytes[index + 1] ?? 0);
  while (sum > 0xffff) sum = (sum & 0xffff) + (sum >>> 16);
  return ~sum & 0xffff;
}

/** One Ethernet/IPv4/TCP frame with correct checksums, so analysis tools accept it. */
function frame({ fromClient, port, seq, ack, flags, payload = Buffer.alloc(0) }) {
  const [source, destination] = fromClient ? [CLIENT, SERVER] : [SERVER, CLIENT];
  const tcp = Buffer.alloc(20 + payload.length);
  tcp.writeUInt16BE(fromClient ? port : 80, 0);
  tcp.writeUInt16BE(fromClient ? 80 : port, 2);
  tcp.writeUInt32BE(seq, 4);
  tcp.writeUInt32BE(ack, 8);
  tcp[12] = 5 << 4;
  tcp[13] = flags;
  tcp.writeUInt16BE(64240, 14);
  payload.copy(tcp, 20);
  const pseudo = Buffer.from([...source, ...destination, 0, 6, tcp.length >> 8, tcp.length & 0xff]);
  tcp.writeUInt16BE(checksum(Buffer.concat([pseudo, tcp])), 16);
  const ip = Buffer.alloc(20);
  ip[0] = 0x45;
  ip.writeUInt16BE(20 + tcp.length, 2);
  ip[8] = 64;
  ip[9] = 6;
  Buffer.from([...source, ...destination]).copy(ip, 12);
  ip.writeUInt16BE(checksum(ip), 10);
  const ethernet = Buffer.from([2, 0, 0, 0, 0, fromClient ? 5 : 15, 2, 0, 0, 0, 0, fromClient ? 15 : 5, 8, 0]);
  return Buffer.concat([ethernet, ip, tcp]);
}

function exchange(port, request, response) {
  const [ask, answer] = [Buffer.from(request), Buffer.from(response)];
  const [client, server] = [1000, 5000];
  const [SYN, ACK, PSH] = [2, 16, 8];
  return [
    frame({ fromClient: true, port, seq: client, ack: 0, flags: SYN }),
    frame({ fromClient: false, port, seq: server, ack: client + 1, flags: SYN | ACK }),
    frame({ fromClient: true, port, seq: client + 1, ack: server + 1, flags: ACK }),
    frame({ fromClient: true, port, seq: client + 1, ack: server + 1, flags: PSH | ACK, payload: ask }),
    frame({ fromClient: false, port, seq: server + 1, ack: client + 1 + ask.length, flags: PSH | ACK, payload: answer }),
  ];
}

const login = (user, password) => [
  'GET /admin/backup HTTP/1.1',
  'Host: files.harbourline.test',
  `Authorization: Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`,
  '', '',
].join('\r\n');
const reply = (status, body) => `HTTP/1.1 ${status}\r\nContent-Type: text/plain\r\nContent-Length: ${body.length}\r\n\r\n${body}`;
const DENIED = reply('401 Unauthorized', 'Access denied\n');

export async function generate({ flag, outDir }) {
  const frames = [
    ...exchange(51001, 'GET / HTTP/1.1\r\nHost: files.harbourline.test\r\n\r\n', reply('200 OK', 'Harbourline file server\n')),
    ...exchange(51002, 'GET /admin/backup HTTP/1.1\r\nHost: files.harbourline.test\r\n\r\n', DENIED),
    ...exchange(51003, login('admin', 'admin'), DENIED),
    ...exchange(51004, login('admin', 'harbourline'), DENIED),
    ...exchange(51005, login('jsmith', 'Spring2026!'), DENIED),
    ...exchange(51006, login('svc-backup', flag), reply('200 OK', 'Backup index: 42 files\n')),
    ...exchange(51007, 'GET /robots.txt HTTP/1.1\r\nHost: files.harbourline.test\r\n\r\n', reply('404 Not Found', 'Not found\n')),
  ];
  const header = Buffer.alloc(24);
  header.writeUInt32LE(0xa1b2c3d4, 0);
  header.writeUInt16LE(2, 4);
  header.writeUInt16LE(4, 6);
  header.writeUInt32LE(65535, 16);
  header.writeUInt32LE(1, 20);
  const start = 1_790_000_000;
  const records = frames.flatMap((bytes, index) => {
    const record = Buffer.alloc(16);
    record.writeUInt32LE(start + index, 0);
    record.writeUInt32LE(bytes.length, 8);
    record.writeUInt32LE(bytes.length, 12);
    return [record, bytes];
  });
  await writeFile(join(outDir, 'capture.pcap'), Buffer.concat([header, ...records]));
}
