import 'dotenv/config';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { eq } from 'drizzle-orm';
import { buildApp } from '../dist/app.js';
import { loadConfig } from '../dist/config.js';
import { createPasswordHasher } from '../dist/auth/password.js';
import { createDatabase } from '../dist/db/client.js';
import { DrizzleAuthRepository } from '../dist/db/auth-repository.js';
import { DrizzleCatalogRepository } from '../dist/db/catalog-repository.js';
import { users } from '../dist/db/schema.js';
import { AuthenticationService } from '../dist/services/authentication.js';
import { GmailMailer } from '../dist/services/gmail-mailer.js';
import { withRestoredDemoDatabase } from './local-db-restore-drill.mjs';

const frontend = resolve(process.env.LOCAL_AUTH_FRONTEND_DIRECTORY || '../cyber-range');
const origin = 'http://localhost:3201';
const apiOrigin = 'http://127.0.0.1:4001';
const sendEmails = process.env.LOCAL_AUTH_SEND_EMAILS === 'true';
const recipient = process.env.LOCAL_AUTH_EMAIL_TO || process.env.SMTP_USER;
assert.ok(recipient, 'Configure a local test recipient');
assert.ok(existsSync(join(frontend, '.next', 'BUILD_ID')), 'Build the frontend before running this check');
const { chromium } = await import(pathToFileURL(join(frontend, 'node_modules/@playwright/test/index.mjs')).href);
let stage = 'database restore';

try {
  await withRestoredDemoDatabase(async (databaseUrl) => {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test', DATABASE_URL: databaseUrl,
      FRONTEND_ORIGIN: origin, AUTH_RATE_LIMIT_MAX: '100' });
    const database = createDatabase(databaseUrl);
    const repository = new DrizzleAuthRepository(database.db);
    const hasher = createPasswordHasher();
    const originalPassword = randomBytes(24).toString('base64url');
    const newPassword = randomBytes(24).toString('base64url');
    const captured = new Map();
    const gmail = sendEmails ? new GmailMailer({ user: config.SMTP_USER,
      appPassword: config.SMTP_APP_PASSWORD, senderName: config.EMAIL_SENDER_NAME,
      frontendOrigin: origin }) : undefined;
    if (sendEmails && (!config.SMTP_USER || !config.SMTP_APP_PASSWORD || recipient !== config.SMTP_USER)) {
      throw new Error('Explicit Gmail sender/recipient configuration required');
    }
    const mailer = {
      sendEmailVerification: async (mail) => {
        if (gmail) await gmail.sendEmailVerification(mail);
        captured.set('verification', mail.token);
      },
      sendPasswordReset: async (mail) => {
        if (gmail) await gmail.sendPasswordReset(mail);
        captured.set('reset', mail.token);
      },
    };
    let app;
    let child;
    let browser;
    try {
      stage = 'disposable account';
      const existing = await repository.findAccountByEmail(recipient);
      if (existing) {
        // Only the restored disposable copy is changed; the source account stays untouched.
        await database.db.update(users).set({ passwordHash: await hasher.hash(originalPassword),
          role: 'player', status: 'active', emailVerifiedAt: null }).where(eq(users.id, existing.id));
      } else {
        await repository.seedAccount({ email: recipient, passwordHash: await hasher.hash(originalPassword),
          displayName: 'Local Email Validation', role: 'player', verifiedAt: null });
      }
      const authentication = await AuthenticationService.create({ repository, passwordHasher: hasher, mailer });
      app = await buildApp(config, { database, authentication, catalog: new DrizzleCatalogRepository(database.db) });
      await app.listen({ host: '127.0.0.1', port: 4001 });
      stage = 'frontend startup';
      const environment = Object.fromEntries(['PATH', 'Path', 'SystemRoot', 'COMSPEC', 'USERPROFILE', 'LOCALAPPDATA', 'TEMP', 'TMP']
        .filter((key) => process.env[key]).map((key) => [key, process.env[key]]));
      child = spawn(process.execPath, [join(frontend, 'node_modules/next/dist/bin/next'),
        'start', '--hostname', '127.0.0.1', '--port', '3201'], {
        cwd: frontend, windowsHide: true, stdio: 'ignore', env: { ...environment, NODE_ENV: 'production',
          BACKEND_URL: apiOrigin, BFF_PUBLIC_ORIGIN: origin,
          BFF_AUTH_SECRET: config.BFF_AUTH_SECRET, BFF_SESSION_SECRET: randomBytes(32).toString('base64url'),
          BACKEND_SERVICE_TOKEN_SECRET: config.BACKEND_SERVICE_TOKEN_SECRET,
          SERVICE_TOKEN_ISSUER: config.SERVICE_TOKEN_ISSUER, SERVICE_TOKEN_AUDIENCE: config.SERVICE_TOKEN_AUDIENCE },
      });
      let spawnFailed = false;
      child.on('error', () => { spawnFailed = true; });
      let ready = false;
      for (let count = 0; count < 100; count++) {
        if (spawnFailed || child.exitCode !== null) throw new Error('Frontend startup failed');
        try { ready = (await fetch(`${origin}/login`, { signal: AbortSignal.timeout(1000) })).ok; } catch { /* Starting. */ }
        if (ready) break;
        await delay(100);
      }
      assert.ok(ready);
      process.stdout.write('Isolated local auth frontend ready at http://localhost:3201/login.\n');
      const gate = process.env.LOCAL_AUTH_BROWSER_GATE_FILE;
      if (gate) {
        const deadline = Date.now() + 120_000;
        while (!existsSync(gate) && Date.now() < deadline) await delay(250);
        assert.ok(existsSync(gate), 'Browser readiness gate timed out');
      }
      browser = await chromium.launch();
      const context = await browser.newContext();
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.name));
      async function submit(path, status, button) {
        const response = page.waitForResponse((value) => new URL(value.url()).pathname === path);
        await page.getByRole('button', { name: button, exact: true }).click();
        assert.equal((await response).status(), status);
      }
      async function session() { return (await context.request.get(`${origin}/api/auth/session`)).json(); }
      async function login(password) {
        await page.goto(`${origin}/login`);
        await page.getByLabel('Email', { exact: true }).fill(recipient);
        await page.getByLabel('Password', { exact: true }).fill(password);
        await submit('/api/auth/login', 200, 'Sign in');
        await page.waitForURL(`${origin}/labs`);
      }
      async function confirmLink(path, token, action) {
        const link = new URL(path, origin);
        link.searchParams.set('token', token);
        await page.goto(link.href);
        if (action === 'password-reset') await page.getByLabel('New password').fill(newPassword);
        await submit(`/api/auth/${action}/confirm`, 204, 'Confirm');
        await page.getByRole('status').waitFor();
      }
      stage = 'login and browser boundary';
      await login(originalPassword);
      assert.equal((await session()).user.emailVerified, false);
      const cookie = (await context.cookies()).find((value) => value.name === 'ciscoku.backend-session');
      assert.ok(cookie?.httpOnly);
      assert.equal(cookie.sameSite, 'Lax');
      assert.ok(!(await page.evaluate(() => document.cookie)).includes('ciscoku.backend-session'));
      await page.reload();
      assert.equal((await session()).authenticated, true);
      const denied = await context.request.post(`${origin}/api/auth/logout`, { headers: { Origin: 'https://foreign.example.test' } });
      assert.equal(denied.status(), 403);
      assert.equal((await session()).authenticated, true);
      stage = 'email verification';
      await page.goto(`${origin}/verify-email`);
      await page.getByLabel('Email', { exact: true }).fill(recipient);
      await submit('/api/auth/verification/request', 202, 'Send link');
      assert.ok(captured.get('verification'));
      await confirmLink('/verify-email', captured.get('verification'), 'verification');
      assert.equal((await session()).user.emailVerified, true);
      const replay = await context.request.post(`${origin}/api/auth/verification/confirm`, {
        headers: { Origin: origin }, data: { token: captured.get('verification') },
      });
      assert.equal(replay.status(), 400);
      stage = 'password reset';
      await page.goto(`${origin}/forgot-password`);
      await page.getByLabel('Email', { exact: true }).fill(recipient);
      await submit('/api/auth/password-reset/request', 202, 'Send link');
      assert.ok(captured.get('reset'));
      await confirmLink('/reset-password', captured.get('reset'), 'password-reset');
      assert.equal((await session()).authenticated, false);
      const oldLogin = await context.request.post(`${origin}/api/auth/login`, {
        headers: { Origin: origin }, data: { email: recipient, password: originalPassword },
      });
      assert.equal(oldLogin.status(), 401);
      const resetReplay = await context.request.post(`${origin}/api/auth/password-reset/confirm`, {
        headers: { Origin: origin }, data: { token: captured.get('reset'), newPassword },
      });
      assert.equal(resetReplay.status(), 400);
      await login(newPassword);
      assert.equal((await session()).authenticated, true);
      const logout = await context.request.post(`${origin}/api/auth/logout`, { headers: { Origin: origin } });
      assert.equal(logout.status(), 204);
      assert.equal((await session()).authenticated, false);
      assert.deepEqual(errors, []);
      process.stdout.write('Live browser auth passed: login, refresh, HttpOnly cookie, CSRF denial, verification, single-use links, reset revocation, new-password login and logout.\n');
      process.stdout.write(sendEmails ? 'Two Gmail messages were accepted; inbox receipt still requires operator confirmation.\n' : 'Email links were captured in memory only; no messages sent.\n');
    } finally {
      await browser?.close();
      if (child && child.exitCode === null) {
        const exited = new Promise((done) => child.once('exit', done));
        child.kill();
        await exited;
      }
      if (app) await app.close(); else await database.close();
    }
  });
} catch {
  process.stderr.write(`Local auth browser check failed during ${stage}; credentials and link tokens suppressed.\n`);
  process.exitCode = 1;
}
