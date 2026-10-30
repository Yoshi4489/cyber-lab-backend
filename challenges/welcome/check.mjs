import { pathToFileURL } from 'node:url';

/** Benign readiness check. Never emits response bodies or displayed flag values. */
export async function checkWelcome(baseUrl, request = fetch) {
  const url = new URL(baseUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !url.pathname.endsWith('/')) {
    throw new Error('Invalid Welcome target URL');
  }
  const options = { redirect: 'error', signal: AbortSignal.timeout(5000) };
  const health = await request(new URL('health', url), options);
  if (health.status !== 200 || await health.text() !== 'ok\n') throw new Error('Welcome health check failed');
  const page = await request(url, options);
  if (page.status !== 200 || !(page.headers.get('content-type') ?? '').startsWith('text/html')) throw new Error('Welcome page check failed');
  await page.body?.cancel();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 3) throw new Error('A target URL is required');
    await checkWelcome(process.argv[2]);
    process.stdout.write('Welcome readiness check passed\n');
  } catch {
    process.stderr.write('Welcome readiness check failed\n');
    process.exitCode = 1;
  }
}
