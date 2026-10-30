/** @param {string | undefined} flag */
export function createWelcomeHandler(flag) {
  // eslint-disable-next-line no-control-regex -- Runtime text must not contain control characters.
  if (typeof flag !== 'string' || flag.trim().length === 0 || flag.length > 512 || /[\u0000-\u001f\u007f]/u.test(flag)) {
    throw new Error('A valid runtime flag is required');
  }
  const escapedFlag = flag.replace(/[&<>"']/gu, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
  const page = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Welcome | CiscoKU Lab</title><style>
body{margin:0;background:#f7f7fb;color:#25243b;font:1.1rem/1.6 system-ui,sans-serif}
main{max-width:42rem;margin:8vh auto;padding:2rem}h1{line-height:1.15}code{display:block;overflow-wrap:anywhere;background:#fff;border:1px solid #d7d5e5;border-radius:.75rem;padding:1rem;color:#4734a0}
</style></head><body><main><p>CiscoKU Lab · introductory activity</p><h1>Welcome to your first lab</h1>
<p>This is a harmless practice page. Your private lab is running and ready to explore.</p>
<p>Copy the flag below. Return to your lab session to use it when flag submission is available.</p>
<code>${escapedFlag}</code><p>Practice only within the target assigned to your account. You can stop this lab from your session page.</p>
</main></body></html>`;
  /** @param {import('node:http').IncomingMessage} request @param {import('node:http').ServerResponse} response */
  return (request, response) => {
    const headers = {
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    };
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { ...headers, allow: 'GET, HEAD', 'content-type': 'text/plain; charset=utf-8' });
      response.end('method not allowed\n');
      return;
    }
    const pathname = request.url?.split('?', 1)[0];
    const home = pathname === '/';
    const healthy = pathname === '/health';
    response.writeHead(home || healthy ? 200 : 404, {
      ...headers, 'content-type': home ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8',
    });
    response.end(request.method === 'HEAD' ? undefined : home ? page : healthy ? 'ok\n' : 'not found\n');
  };
}
