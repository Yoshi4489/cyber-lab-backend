// INTENTIONALLY VULNERABLE: CWE-89 for authorized training inside an isolated lab only.
import { createHash, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { cookies, escapeHtml, page, readForm, redirect, send, serve, takeFlag } from './_lab/runtime.mjs';

const flag = await takeFlag();
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const database = new DatabaseSync(':memory:');
database.exec(`create table staff (username text, password_hash text, role text, note text);`);
const insert = database.prepare('insert into staff values (?, ?, ?, ?)');
insert.run('j.alvarez', sha256(randomBytes(24).toString('hex')), 'clerk', 'Front desk rota');
insert.run('s.okafor', sha256(randomBytes(24).toString('hex')), 'clerk', 'Stockroom keys');
insert.run('administrator', sha256(randomBytes(24).toString('hex')), 'admin', `Payroll export key: ${flag}`);
const sessions = new Map();

serve(async (request, response, url) => {
  if (url.pathname === '/' ) {
    return send(response, 200, page('Staff portal', `<h1>Ashgrove Clinic staff portal</h1>
<form method="post" action="login"><label>Username <input name="username"></label><br><label>Password <input name="password" type="password"></label><br><button>Sign in</button></form>`));
  }
  if (url.pathname === '/login' && request.method === 'POST') {
    const form = await readForm(request);
    // Vulnerable on purpose: user input is concatenated into the query.
    const query = `select username, role, note from staff where username = '${form.get('username') ?? ''}' and password_hash = '${sha256(form.get('password') ?? '')}'`;
    let row;
    try {
      row = database.prepare(query).get();
    } catch (error) {
      return send(response, 500, page('Database error', `<h1>Database error</h1><pre>${escapeHtml(error.message)}</pre><p><a href="./">Back</a></p>`));
    }
    if (!row) return send(response, 401, page('Staff portal', '<p>Invalid credentials. <a href="./">Back</a></p>'));
    const session = randomBytes(24).toString('hex');
    sessions.set(session, row);
    return redirect(response, 'dashboard', { 'Set-Cookie': `session=${session}; HttpOnly; SameSite=Lax` });
  }
  if (url.pathname === '/dashboard') {
    const staff = sessions.get(cookies(request).session);
    if (!staff) return redirect(response, './');
    const note = staff.role === 'admin' ? `<p>Admin note: ${escapeHtml(staff.note)}</p>` : '<p>No admin notes for your role.</p>';
    return send(response, 200, page('Dashboard', `<h1>Hello, ${escapeHtml(staff.username)}</h1><p>Role: ${escapeHtml(staff.role)}</p>${note}`));
  }
  return send(response, 404, page('Not found', '<p>Not found.</p>'));
});
