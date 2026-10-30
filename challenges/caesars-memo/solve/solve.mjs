// Benign solver: prints only the recovered flag, for the check harness.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const memo = await readFile(join(process.env.ARTIFACTS, 'memo.txt'), 'utf8');
for (let by = 1; by < 26; by += 1) {
  const plain = memo.replace(/[a-z]/giu, (letter) => {
    const base = letter <= 'Z' ? 65 : 97;
    return String.fromCharCode(((letter.charCodeAt(0) - base + by) % 26) + base);
  });
  const code = /Release code: (\S+)/u.exec(plain)?.[1];
  if (code) {
    process.stdout.write(Buffer.from(code, 'base64').toString());
    process.exit(0);
  }
}
process.exit(1);
