import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function generate({ flag, outDir }) {
  const key = [...randomBytes(7)];
  const table = [...Buffer.from(flag)].map((byte, index) => ((byte ^ key[index % key.length]) + index) & 0xff);
  await writeFile(join(outDir, 'license_check.js'), `#!/usr/bin/env node
// Lighthouse Suite activation tool. Usage: node license_check.js <serial>
const TABLE = [${table.join(', ')}];
const KEY = [${key.join(', ')}];

function check(serial) {
  const bytes = Buffer.from(serial);
  if (bytes.length !== TABLE.length) return false;
  return bytes.every((byte, i) => ((byte ^ KEY[i % KEY.length]) + i & 0xff) === TABLE[i]);
}

console.log(check(process.argv[2] ?? '') ? 'License activated.' : 'Invalid serial.');
`);
}
