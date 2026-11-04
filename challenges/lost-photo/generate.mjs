import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { crc32, deflateSync, gzipSync } from 'node:zlib';

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

const text = (keyword, value) => chunk('tEXt', Buffer.from(`${keyword}\0${value}`, 'latin1'));

export async function generate({ flag, outDir }) {
  const [width, height] = [320, 240];
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  // A plain sky-and-sea gradient: the photo itself holds nothing.
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 3);
    for (let x = 0; x < width; x += 1) {
      row[1 + x * 3] = y < 150 ? 120 + y / 3 : 20;
      row[2 + x * 3] = y < 150 ? 170 + y / 4 : 80 + (x % 17);
      row[3 + x * 3] = y < 150 ? 225 : 130;
    }
    rows.push(row);
  }
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    text('Software', 'ScanStation 3.2'),
    text('Author', 'R. Okafor'),
    text('Comment', 'Case note stored with this scan.'),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  const note = gzipSync(Buffer.from(`Case 0417 evidence note.\nCustody code: ${flag}\n`));
  await writeFile(join(outDir, 'scan-0417.png'), Buffer.concat([png, note]));
}
