// INTENTIONALLY VULNERABLE: CWE-639 for authorized training inside an isolated lab only.
import { randomBytes } from 'node:crypto';
import { cookies, escapeHtml, page, readForm, redirect, send, serve, takeFlag } from './_lab/runtime.mjs';

const flag = await takeFlag();
const sessions = new Map();
const accounts = { 'guest@northwind.test': { password: 'guest-demo', customer: 'Harbor Cafe' } };
const invoices = new Map([
  [1001, { owner: 'Northwind Board', amount: '$18,420.00', description: 'Acquisition advisory retainer', memo: `Confidential approval code: ${flag}` }],
  [1002, { owner: 'Lakeside Dental', amount: '$310.50', description: 'Quarterly support', memo: 'Paid by card' }],
  [1003, { owner: 'Fern & Co', amount: '$96.00', description: 'Domain renewal', memo: 'Net 30' }],
  [1042, { owner: 'Harbor Cafe', amount: '$129.00', description: 'Point-of-sale support', memo: 'Thanks for your business!' }],
  [1043, { owner: 'Harbor Cafe', amount: '$64.25', description: 'Receipt paper', memo: 'Delivered Tuesday' }],
]);

serve(async (request, response, url) => {
  const account = sessions.get(cookies(request).session);
  if (url.pathname === '/' && !account) {
    return send(response, 200, page('Northwind Billing', `<h1>Northwind Billing</h1><p>Sign in to view your invoices. Demo account: <code>guest@northwind.test</code> / <code>guest-demo</code></p>
<form method="post" action="login"><label>Email <input name="email"></label><br><label>Password <input name="password" type="password"></label><br><button>Sign in</button></form>`));
  }
  if (url.pathname === '/login' && request.method === 'POST') {
    const form = await readForm(request);
    const found = accounts[form.get('email') ?? ''];
    if (found?.password !== form.get('password')) {
      return send(response, 401, page('Northwind Billing', '<p>Sign-in failed. <a href="./">Try again</a></p>'));
    }
    const session = randomBytes(24).toString('hex');
    sessions.set(session, found);
    return redirect(response, 'invoices', { 'Set-Cookie': `session=${session}; HttpOnly; SameSite=Lax` });
  }
  if (!account) return redirect(response, './');
  if (url.pathname === '/' || url.pathname === '/invoices') {
    const rows = [...invoices].filter(([, invoice]) => invoice.owner === account.customer)
      .map(([id, invoice]) => `<tr><td><a href="invoice?id=${id}">#${id}</a></td><td>${escapeHtml(invoice.description)}</td><td>${escapeHtml(invoice.amount)}</td></tr>`).join('');
    return send(response, 200, page('Your invoices', `<h1>${escapeHtml(account.customer)}</h1><table><tr><th>Invoice</th><th>Description</th><th>Amount</th></tr>${rows}</table>`));
  }
  if (url.pathname === '/invoice') {
    // Vulnerable on purpose: the signed-in user is never compared with the invoice owner.
    const invoice = invoices.get(Number(url.searchParams.get('id')));
    if (!invoice) return send(response, 404, page('Not found', '<p>No such invoice. <a href="invoices">Back</a></p>'));
    return send(response, 200, page('Invoice', `<h1>Invoice for ${escapeHtml(invoice.owner)}</h1><p>${escapeHtml(invoice.description)}: <strong>${escapeHtml(invoice.amount)}</strong></p><p>Memo: ${escapeHtml(invoice.memo)}</p><p><a href="invoices">Back</a></p>`));
  }
  return send(response, 404, page('Not found', '<p>Not found.</p>'));
});
