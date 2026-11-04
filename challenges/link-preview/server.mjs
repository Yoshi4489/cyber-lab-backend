// INTENTIONALLY VULNERABLE: CWE-918 for authorized training inside an isolated lab only.
import { escapeHtml, page, send, serve } from './_lab/runtime.mjs';

// Vulnerable on purpose: a denylist of exact host spellings stands in for checking where a request really goes.
const blockedNames = new Set(['metadata', 'localhost']);
const privateAddress = /^(0|10|127|169\.254|172\.(1[6-9]|2\d|3[01])|192\.168)\./u;
const blocked = (host) => blockedNames.has(host) || privateAddress.test(host) || host.startsWith('[');

serve(async (_request, response, url) => {
  if (url.pathname === '/') {
    return send(response, 200, page('Link Preview', '<h1>Link Preview</h1><p>Paste a link and our server fetches it, so you can check where it goes before you click.</p><form action="/preview"><input name="url" size="50" placeholder="http://example.test/" required> <button>Preview</button></form><p><small>Internal addresses, such as our metadata service, are blocked.</small></p>'));
  }
  if (url.pathname === '/preview') {
    let target;
    try {
      target = new URL(url.searchParams.get('url') ?? '');
    } catch {
      return send(response, 400, page('Invalid link', '<p>That is not a valid link. <a href="/">Back</a></p>'));
    }
    if (!['http:', 'https:'].includes(target.protocol)) {
      return send(response, 400, page('Unsupported link', '<p>Only http and https links can be previewed. <a href="/">Back</a></p>'));
    }
    if (blocked(target.hostname)) {
      return send(response, 403, page('Blocked', '<p>That address is internal and blocked. <a href="/">Back</a></p>'));
    }
    const fetched = await fetch(target, { redirect: 'manual', signal: AbortSignal.timeout(4_000) }).catch(() => null);
    if (!fetched) return send(response, 502, page('Unreachable', '<p>We could not fetch that link. <a href="/">Back</a></p>'));
    const text = (await fetched.text()).slice(0, 4_000);
    const title = /<title>([^<]*)<\/title>/iu.exec(text)?.[1] ?? '(no title)';
    return send(response, 200, page('Preview', `<h1>Preview</h1><table><tr><th>Status</th><td>${fetched.status}</td></tr><tr><th>Type</th><td>${escapeHtml(fetched.headers.get('content-type') ?? '')}</td></tr><tr><th>Title</th><td>${escapeHtml(title)}</td></tr></table><h2>Content</h2><pre>${escapeHtml(text)}</pre><p><a href="/">Back</a></p>`));
  }
  return send(response, 404, page('Not found', '<p>Not found.</p>'));
});
