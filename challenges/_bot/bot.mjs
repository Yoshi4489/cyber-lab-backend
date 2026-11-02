// Admin bot: idle until its lab app asks for one visit, then a short-lived headless Chromium.
// It holds no secrets; the app passes the admin session for each visit.
import { lookup } from 'node:dns/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';
import { readForm, send, serve } from './_lab/runtime.mjs';

const VISIT_MS = 10_000;
let busy = false;

async function visit(path, session) {
  // `app` is an HSTS-preloaded top-level domain, so Chromium would force HTTPS on it; visit by address.
  const app = `http://${(await lookup('app', { family: 4 })).address}:8080`;
  const profile = await mkdtemp('/tmp/profile-');
  // The container is the sandbox: no egress, no credentials, read-only root, no capabilities.
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium-browser',
    headless: true,
    userDataDir: profile,
    args: ['--no-sandbox', '--no-zygote', '--disable-dev-shm-usage', '--disable-gpu', '--renderer-process-limit=1',
      '--disable-extensions', '--disable-background-networking', '--disable-breakpad', '--disable-component-update',
      '--disable-sync', '--no-first-run', '--mute-audio'],
  });
  const deadline = setTimeout(() => browser.process()?.kill('SIGKILL'), VISIT_MS);
  try {
    const page = await browser.newPage();
    await page.setCookie({ name: 'admin_session', value: session, url: app, httpOnly: true, sameSite: 'Strict' });
    await page.goto(`${app}${path}`, { waitUntil: 'load', timeout: 5_000 });
    // Give the page's own scripts time to run, as an agent reading the ticket would.
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  } finally {
    clearTimeout(deadline);
    await browser.close().catch(() => browser.process()?.kill('SIGKILL'));
    await rm(profile, { recursive: true, force: true });
  }
}

serve(async (request, response, url) => {
  if (request.method !== 'POST' || url.pathname !== '/visit') return send(response, 404, 'Not found\n', 'text/plain');
  if (busy) return send(response, 429, 'Busy\n', 'text/plain');
  busy = true;
  try {
    const form = await readForm(request);
    const path = form.get('path') ?? '';
    const session = form.get('session') ?? '';
    if (!/^\/[A-Za-z0-9/_-]{0,200}$/u.test(path) || !/^[A-Za-z0-9_-]{16,128}$/u.test(session)) {
      return send(response, 400, 'Bad visit\n', 'text/plain');
    }
    await visit(path, session).catch((error) => process.stderr.write(`Visit failed: ${error.message}\n`));
    return send(response, 200, 'Visited\n', 'text/plain');
  } finally {
    busy = false;
  }
});
