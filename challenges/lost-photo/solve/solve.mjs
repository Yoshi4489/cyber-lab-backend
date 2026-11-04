// Benign solver: prints only the recovered flag, for the check harness.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

const file = await readFile(join(process.env.ARTIFACTS, 'scan-0417.png'));
// A PNG ends after IEND's four CRC bytes; anything later was added to the file.
const end = file.indexOf(Buffer.from('IEND', 'latin1')) + 8;
const note = gunzipSync(file.subarray(end)).toString();
const flag = /Custody code: (\S+)/u.exec(note)?.[1];
if (!flag) process.exit(1);
process.stdout.write(flag);
