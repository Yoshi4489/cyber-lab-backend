// Benign solver: prints only the recovered flag, for the check harness. It reads the tool, never runs it.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const source = await readFile(join(process.env.ARTIFACTS, 'license_check.js'), 'utf8');
const numbers = (name) => new RegExp(`const ${name} = \\[([^\\]]+)\\]`, 'u').exec(source)[1].split(',').map(Number);
const [table, key] = [numbers('TABLE'), numbers('KEY')];
process.stdout.write(Buffer.from(table.map((value, index) => ((value - index) & 0xff) ^ key[index % key.length])).toString());
