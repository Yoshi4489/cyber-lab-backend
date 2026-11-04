// INTENTIONALLY VULNERABLE: CWE-78 for authorized training inside an isolated lab only.
import { exec } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { escapeHtml, page, send, serve, takeFlag } from './_lab/runtime.mjs';

const flag = await takeFlag();
await mkdir('/tmp/ops', { recursive: true });
await writeFile('/tmp/ops/runbook.txt', `Network runbook. Vendor support PIN: ${flag}\n`, { mode: 0o600 });

const run = (command) => new Promise((resolve) => {
  exec(command, { timeout: 4_000, maxBuffer: 64_000 }, (_error, stdout, stderr) => resolve(`${stdout}${stderr}`));
});

serve(async (_request, response, url) => {
  if (url.pathname === '/') {
    return send(response, 200, page('Reachability check', `<h1>Reachability check</h1><p>Check whether a host answers on port 80.</p><form action="check"><label>Host <input name="host" value="127.0.0.1"></label> <button>Check</button></form>`));
  }
  if (url.pathname === '/check') {
    const host = url.searchParams.get('host') ?? '';
    // Vulnerable on purpose: a partial denylist still passes input to a shell.
    if (/[;&]/u.test(host)) {
      return send(response, 400, page('Rejected', '<p>Illegal character in host. <a href="./">Back</a></p>'));
    }
    const output = await run(`nc -z -w 1 ${host} 80 && echo reachable || echo unreachable`);
    return send(response, 200, page('Result', `<h1>Result</h1><pre>${escapeHtml(output)}</pre><p><a href="./">Back</a></p>`));
  }
  return send(response, 404, page('Not found', '<p>Not found.</p>'));
});
