import { generatePrimeSync } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const E = 3n;
const prime = () => generatePrimeSync(1024, { bigint: true });

export async function generate({ flag, outDir }) {
  let p;
  let q;
  do {
    p = prime();
    q = prime();
  } while ((p - 1n) % E === 0n || (q - 1n) % E === 0n);
  const n = p * q;
  const message = BigInt(`0x${Buffer.from(flag).toString('hex')}`);
  const ciphertext = message ** E;
  if (ciphertext >= n) throw new Error('The flag must be small enough for the intended flaw');
  await writeFile(join(outDir, 'output.txt'), `n = ${n}\ne = ${E}\nc = ${ciphertext}\n`);
  await writeFile(join(outDir, 'encrypt.py'), [
    '# How the vault encrypts its secrets.',
    'from Crypto.Util.number import bytes_to_long, getPrime',
    '',
    'p, q = getPrime(1024), getPrime(1024)',
    'n = p * q',
    'e = 3',
    'c = pow(bytes_to_long(open("secret.txt", "rb").read()), e, n)',
    'print(f"n = {n}\\ne = {e}\\nc = {c}")',
    '',
  ].join('\n'));
}
