// INTENTIONALLY VULNERABLE: CWE-22 for authorized training inside an isolated lab only.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { escapeHtml, page, send, serve, takeFlag } from './_lab/runtime.mjs';

const flag = await takeFlag();
const root = '/tmp/lab';
await mkdir(join(root, 'logs'), { recursive: true });
await mkdir(join(root, 'config'), { recursive: true });
await writeFile(join(root, 'logs/app.log'), '[info] service started\n[warn] loaded settings from ../config/backup.conf\n[info] backup finished\n');
await writeFile(join(root, 'logs/access.log'), '10.0.0.12 GET /status 200\n10.0.0.31 GET /status 200\n');
await writeFile(join(root, 'config/backup.conf'), `# Backup job settings\ntarget=sftp://backup.internal/nightly\nencryption_passphrase=${flag}\n`);

serve(async (_request, response, url) => {
  if (url.pathname === '/') {
    return send(response, 200, page('Log viewer', `<h1>Operations log viewer</h1><ul><li><a href="view?file=app.log">app.log</a></li><li><a href="view?file=access.log">access.log</a></li></ul>`));
  }
  if (url.pathname === '/view') {
    const file = url.searchParams.get('file') ?? '';
    try {
      // Vulnerable on purpose: the name is joined without confining it to the logs directory.
      const contents = await readFile(join(root, 'logs', file), 'utf8');
      return send(response, 200, page(file, `<h1>${escapeHtml(file)}</h1><pre>${escapeHtml(contents)}</pre><p><a href="./">Back</a></p>`));
    } catch {
      return send(response, 404, page('Not found', `<p>Could not read ${escapeHtml(file)}. <a href="./">Back</a></p>`));
    }
  }
  return send(response, 404, page('Not found', '<p>Not found.</p>'));
});
