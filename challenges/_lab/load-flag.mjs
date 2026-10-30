// One-shot worker delivery: the flag exists in this process's environment only.
import { rename, writeFile } from 'node:fs/promises';

const flag = process.env.CYBER_RANGE_FLAG;
if (!flag) process.exit(1);
await writeFile('/tmp/.cr-flag.tmp', flag, { mode: 0o600 });
await rename('/tmp/.cr-flag.tmp', '/tmp/.cr-flag');
