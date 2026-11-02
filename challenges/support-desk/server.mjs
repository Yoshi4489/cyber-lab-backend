// INTENTIONALLY VULNERABLE: CWE-79 for authorized training inside an isolated lab only.
import { randomBytes } from 'node:crypto';
import { cookies, escapeHtml, page, readForm, redirect, send, serve, takeFlag } from './_lab/runtime.mjs';

const flag = await takeFlag();
// Only the bot ever holds this session, and only for one visit at a time.
const adminSession = randomBytes(32).toString('base64url');
const tickets = new Map();
const isAdmin = (request) => cookies(request).admin_session === adminSession;

async function review(id) {
  const response = await fetch('http://bot:8080/visit', {
    method: 'POST',
    body: new URLSearchParams({ path: `/tickets/${id}`, session: adminSession }),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (response?.status === 200) return 'An agent has read your ticket.';
  if (response?.status === 429) return 'All agents are busy. Submit the ticket again in a few seconds.';
  return 'No agent could read your ticket. Submit it again.';
}

serve(async (request, response, url) => {
  if (url.pathname === '/') {
    return send(response, 200, page('Support Desk', `<h1>Support Desk</h1><p>Tell us what went wrong. An agent reads every new ticket straight away.</p><form method="post" action="/tickets"><label>Subject<br><input name="subject" maxlength="120" required></label><br><label>Describe the problem<br><textarea name="body" rows="8" cols="60" maxlength="4000" required></textarea></label><br><button>Submit ticket</button></form>`));
  }
  if (url.pathname === '/tickets' && request.method === 'POST') {
    const form = await readForm(request);
    const id = randomBytes(8).toString('hex');
    if (tickets.size >= 200) tickets.delete(tickets.keys().next().value);
    tickets.set(id, { subject: (form.get('subject') ?? '').slice(0, 120), body: (form.get('body') ?? '').slice(0, 4_000), replies: [], status: 'Waiting for an agent.' });
    tickets.get(id).status = await review(id);
    return redirect(response, `/tickets/${id}`);
  }
  const match = /^\/tickets\/([0-9a-f]{16})(\/replies)?$/u.exec(url.pathname);
  const ticket = match && tickets.get(match[1]);
  if (ticket && match[2] && request.method === 'POST') {
    const text = ((await readForm(request)).get('body') ?? '').slice(0, 2_000);
    if (text && ticket.replies.length < 20) ticket.replies.push({ author: isAdmin(request) ? 'Agent' : 'Customer', text });
    return redirect(response, `/tickets/${match[1]}`);
  }
  if (ticket && !match[2]) {
    const replies = ticket.replies.map((reply) => `<li><strong>${reply.author}:</strong> ${escapeHtml(reply.text)}</li>`).join('');
    // Vulnerable on purpose: the ticket body is rendered as HTML, so it runs in the agent's browser too.
    return send(response, 200, page(ticket.subject, `<h1>${escapeHtml(ticket.subject)}</h1><p><em>${escapeHtml(ticket.status)}</em></p><div class="ticket">${ticket.body}</div><h2>Replies</h2><ul>${replies || '<li>No replies yet.</li>'}</ul><form method="post" action="/tickets/${match[1]}/replies"><textarea name="body" rows="3" cols="60" maxlength="2000" required></textarea><br><button>Reply</button></form><p><a href="/">New ticket</a></p>`));
  }
  if (url.pathname === '/admin') {
    if (!isAdmin(request)) return send(response, 403, page('Agents only', '<p>This page is for support agents.</p>'));
    return send(response, 200, page('Agent console', `<h1>Agent console</h1><p>${tickets.size} open tickets.</p><h2>Integration settings</h2><p>Helpdesk API key: <code>${escapeHtml(flag)}</code></p>`));
  }
  return send(response, 404, page('Not found', '<p>Not found.</p>'));
});
