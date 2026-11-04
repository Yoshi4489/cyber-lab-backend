import { randomInt } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const shift = (text, by) => text.replace(/[a-z]/giu, (letter) => {
  const base = letter <= 'Z' ? 65 : 97;
  return String.fromCharCode(((letter.charCodeAt(0) - base + by) % 26) + base);
});

export async function generate({ flag, outDir }) {
  const memo = [
    'From the desk of the operations director.',
    '',
    'The quarterly stock count at the harbour warehouse finished on Friday, and the',
    'totals agree with the ledger. Please thank the night shift for staying late.',
    'The new supplier will start deliveries at the beginning of next month, so the',
    'loading bay must be clear by then. When you need the safe opened, use the release',
    'code below. It is encoded the usual way, so nobody reading over your shoulder',
    'can read it at a glance.',
    '',
    `Release code: ${Buffer.from(flag).toString('base64')}`,
    '',
    'Destroy this memo when you have finished with it.',
  ].join('\n');
  await writeFile(join(outDir, 'memo.txt'), `${shift(memo, randomInt(1, 26))}\n`);
}
