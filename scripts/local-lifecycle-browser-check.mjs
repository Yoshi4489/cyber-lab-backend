import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { parse } from 'dotenv';

// Operator-established loopback SSH tunnels only; this does not expose services publicly.
const origin = 'http://localhost:3202';
const frontend = resolve(process.env.LOCAL_LIFECYCLE_FRONTEND_DIRECTORY || '../cyber-range');
const privateFile = process.env.LOCAL_LIFECYCLE_ENV_FILE;
assert.ok(privateFile, 'Provide the private VM API configuration file');
const config = parse(readFileSync(privateFile));
assert.ok(existsSync(join(frontend, '.next', 'BUILD_ID')), 'Build the frontend first');
const { chromium, expect } = await import(pathToFileURL(join(frontend, 'node_modules/@playwright/test/index.mjs')).href);
let stage = 'frontend startup';
let child;
let browser;
let context;
let instanceId;
let stopped = false;

async function readInstance() {
  const response = await context.request.get(`${origin}/api/instances/${instanceId}`);
  assert.equal(response.status(), 200);
  return response.json();
}
async function poll(check, timeout = 60_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(1000);
  }
  throw new Error('Bounded operation poll timed out');
}
try {
  const environment = Object.fromEntries(['PATH', 'Path', 'SystemRoot', 'COMSPEC', 'USERPROFILE', 'LOCALAPPDATA', 'TEMP', 'TMP']
    .filter((key) => process.env[key]).map((key) => [key, process.env[key]]));
  child = spawn(process.execPath, [join(frontend, 'node_modules/next/dist/bin/next'),
    'start', '--hostname', '127.0.0.1', '--port', '3202'], {
    cwd: frontend, windowsHide: true, stdio: 'ignore', env: { ...environment, NODE_ENV: 'production',
      BACKEND_URL: 'http://127.0.0.1:4002', BFF_PUBLIC_ORIGIN: origin,
      BFF_AUTH_SECRET: config.BFF_AUTH_SECRET, BFF_SESSION_SECRET: randomBytes(32).toString('base64url'),
      BACKEND_SERVICE_TOKEN_SECRET: config.BACKEND_SERVICE_TOKEN_SECRET,
      SERVICE_TOKEN_ISSUER: config.SERVICE_TOKEN_ISSUER, SERVICE_TOKEN_AUDIENCE: config.SERVICE_TOKEN_AUDIENCE },
  });
  let spawnFailed = false;
  child.on('error', () => { spawnFailed = true; });
  await poll(async () => {
    if (spawnFailed || child.exitCode !== null) throw new Error('Frontend startup failed');
    try { return (await fetch(`${origin}/login`, { signal: AbortSignal.timeout(1000) })).ok; } catch { return false; }
  }, 15_000);
  process.stdout.write('Isolated lifecycle frontend ready at http://localhost:3202/login.\n');
  if (process.env.LOCAL_LIFECYCLE_BROWSER_GATE_FILE) {
    await poll(async () => existsSync(process.env.LOCAL_LIFECYCLE_BROWSER_GATE_FILE), 120_000);
  }
  browser = await chromium.launch();
  context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.name));
  async function clickResponse(path, method, button) {
    const pending = page.waitForResponse((response) => new URL(response.url()).pathname === path && response.request().method() === method);
    await page.getByRole('button', { name: button, exact: true }).click();
    return pending;
  }
  stage = 'seeded player login';
  await page.goto(`${origin}/login`);
  await page.getByLabel('Email', { exact: true }).fill(config.SEED_PLAYER_EMAIL);
  await page.getByLabel('Password', { exact: true }).fill(config.SEED_PLAYER_PASSWORD);
  assert.equal((await clickResponse('/api/auth/login', 'POST', 'Sign in')).status(), 200);
  await page.waitForURL(`${origin}/labs`);
  await page.goto(`${origin}/labs/sample-web-a/session`);
  await expect(page.getByTestId('lab-status')).toHaveText('Not started');
  assert.equal(await page.getByTestId('lab-target').count(), 0);
  stage = 'real worker spawn';
  const created = await clickResponse('/api/instances', 'POST', 'Start Lab');
  assert.equal(created.status(), 202);
  instanceId = (await created.json()).instance.id;
  assert.match(instanceId, /^[0-9a-f-]{36}$/);
  stage = 'readiness polling';
  await expect(page.getByTestId('lab-status')).toHaveText('running', { timeout: 60_000 });
  const target = new URL(await page.getByTestId('lab-target').getAttribute('href'));
  assert.equal(target.protocol, 'https:');
  assert.equal(target.hostname, '127.0.0.1');
  assert.equal(target.port, '8443');
  const health = new URL(`${target.pathname.replace(/\/$/, '')}/health`, target.origin);
  stage = 'ingress health';
  // The disposable ingress uses a self-signed certificate. The exception is
  // confined to this explicitly checked loopback health request, never Docker.
  await poll(async () => (await context.request.get(health.href, { ignoreHTTPSErrors: true })).status() === 200);
  stage = 'refresh and extension';
  await page.reload();
  await expect(page.getByTestId('lab-status')).toHaveText('running');
  const before = await readInstance();
  assert.equal((await clickResponse(`/api/instances/${instanceId}/extend`, 'POST', 'Extend 30 minutes')).status(), 202);
  await poll(async () => {
    const current = await readInstance();
    assert.ok(Date.parse(current.expiresAt) <= Date.parse(current.absoluteExpiresAt));
    return Date.parse(current.expiresAt) > Date.parse(before.expiresAt);
  });
  stage = 'real worker destruction';
  assert.equal((await clickResponse(`/api/instances/${instanceId}`, 'DELETE', 'Stop Lab')).status(), 202);
  await expect(page.getByTestId('lab-status')).toHaveText('stopped', { timeout: 60_000 });
  stopped = true;
  assert.equal(await page.getByTestId('lab-target').count(), 0);
  assert.equal(await page.evaluate(() => localStorage.getItem('ciscoku:active-instance:v1')), null);
  await poll(async () => (await context.request.get(health.href, { ignoreHTTPSErrors: true })).status() === 404);
  assert.deepEqual(errors, []);
  process.stdout.write('Real-worker browser lifecycle passed: start, readiness-only target, HTTPS health, refresh, extension cap, stop, forgotten terminal instance and route removal.\n');
} catch {
  process.stderr.write(`Lifecycle browser check failed during ${stage}; secrets and target route suppressed.\n`);
  if (instanceId) {
    try {
      const current = await readInstance();
      process.stderr.write(`Owned instance status: ${current.status}; failure code: ${current.failureCode ?? 'none'}.\n`);
    } catch { process.stderr.write('Frontend instance read did not match its expected contract.\n'); }
  }
  process.exitCode = 1;
} finally {
  try {
    if (instanceId && !stopped) {
      const result = await context.request.delete(`${origin}/api/instances/${instanceId}`, {
        headers: { Origin: origin, 'Idempotency-Key': `cleanup-${randomUUID()}` },
      });
      assert.equal(result.status(), 202);
      await poll(async () => ['stopped', 'expired', 'failed'].includes((await readInstance()).status));
      process.stdout.write('Owned test instance cleanup completed.\n');
    }
    if (context) await context.request.post(`${origin}/api/auth/logout`, { headers: { Origin: origin } });
  } catch {
    process.stderr.write('Owned instance cleanup needs operator verification; worker must remain available.\n');
    process.exitCode = 1;
  } finally {
    await browser?.close();
    if (child && child.exitCode === null) {
      const exited = new Promise((done) => child.once('exit', done));
      child.kill();
      await exited;
    }
  }
}
