// Internal deploy vault: returns the secret only to a caller holding the deploy token.
// The token is an operational credential, not the flag; the lab leaks it on purpose.
import { send, serve, takeFlag } from './_lab/runtime.mjs';

const flag = await takeFlag();
const TOKEN = 'r0tate-me-2026-ops-deploy';

serve((request, response, url) => {
  if (url.pathname !== '/') return send(response, 404, 'Not found\n', 'text/plain');
  if ((request.headers['x-vault-token'] ?? '') !== TOKEN) {
    return send(response, 403, 'Forbidden: a valid X-Vault-Token is required.\n', 'text/plain');
  }
  return send(response, 200, `${flag}\n`, 'text/plain');
});
