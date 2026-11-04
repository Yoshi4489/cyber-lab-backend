// Benign solver: prints only the recovered flag, for the check harness.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const output = await readFile(join(process.env.ARTIFACTS, 'output.txt'), 'utf8');
const c = BigInt(/c = (\d+)/u.exec(output)[1]);

// With no padding and a small message, m^3 never wrapped around n, so c is a perfect cube.
let low = 0n;
let high = 1n << 2048n;
while (low < high) {
  const middle = (low + high + 1n) >> 1n;
  if (middle ** 3n <= c) low = middle;
  else high = middle - 1n;
}
if (low ** 3n !== c) process.exit(1);
process.stdout.write(Buffer.from(low.toString(16), 'hex').toString());
