import { randomUUID } from 'node:crypto';
import { request as httpsRequest } from 'node:https';
import { setTimeout as delay } from 'node:timers/promises';
import { SignJWT } from 'jose';

const challengeId = '11111111-1111-4111-8111-111111111111';
const apiBase = new URL(process.env.PHASE3_API_BASE_URL ?? 'http://127.0.0.1:4000');
const ingressBase = new URL(required('LAB_PUBLIC_BASE_URL'));
const mode = process.argv[2] ?? 'full';
const recoveryId = process.argv[3];

if (apiBase.protocol !== 'http:' || !isLoopback(apiBase.hostname)) {
  throw new Error('Phase 3 validation requires a loopback HTTP API');
}
if (ingressBase.protocol !== 'https:' || !isLoopback(ingressBase.hostname)) {
  throw new Error('Phase 3 validation requires a loopback HTTPS ingress');
}
if (!['full', 'prepare-recovery', 'resume-recovery'].includes(mode)) {
  throw new Error('Use full, prepare-recovery, or resume-recovery');
}
if (mode === 'resume-recovery' && !/^[0-9a-f-]{36}$/iu.test(recoveryId ?? '')) {
  throw new Error('resume-recovery requires an instance UUID');
}

const bffSecret = required('BFF_AUTH_SECRET');
const signingSecret = required('BACKEND_SERVICE_TOKEN_SECRET');
const issuer = required('SERVICE_TOKEN_ISSUER');
const audience = required('SERVICE_TOKEN_AUDIENCE');
let instanceId = mode === 'resume-recovery' ? recoveryId : undefined;
let cleanedUp = false;
let preparedRecovery = false;
let sessionToken;
let identity;

try {
  const login = await api('POST', '/v1/auth/login', {
    bearer: bffSecret,
    body: {
      email: required('SEED_PLAYER_EMAIL'),
      password: required('SEED_PLAYER_PASSWORD'),
    },
    expect: 200,
  });
  sessionToken = login.sessionToken;
  const resolved = await api('POST', '/v1/auth/session', {
    bearer: bffSecret,
    body: { sessionToken },
    expect: 200,
  });
  if (resolved.user.id !== login.user.id || resolved.sessionId !== login.sessionId) {
    throw new Error('Backend session resolution did not match login');
  }
  for (const scope of ['instances:read', 'instances:write', 'submissions:write']) {
    if (!resolved.allowedScopes.includes(scope)) throw new Error(`Test player lacks ${scope}`);
  }
  identity = { userId: resolved.user.id, sessionId: resolved.sessionId };

  if (mode !== 'resume-recovery') {
    const idempotencyKey = `phase3-create-${randomUUID()}`;
    const created = await domain('POST', '/v1/instances', {
      body: { challengeId }, idempotencyKey, expect: 202,
    });
    instanceId = created.instance.id;
    if (created.instance.status !== 'pending' || created.instance.url || created.replayed) {
      throw new Error('Create did not return fresh pending intent without a URL');
    }
    const replay = await domain('POST', '/v1/instances', {
      body: { challengeId }, idempotencyKey, expect: 202,
    });
    if (!replay.replayed || replay.operationId !== created.operationId) {
      throw new Error('Create idempotency replay changed the operation');
    }
    report('created', { instanceId, status: created.instance.status });
  }

  if (mode === 'prepare-recovery') {
    await delay(4_000);
    const view = await domain('GET', `/v1/instances/${instanceId}`, { expect: 200 });
    if (view.status !== 'pending') {
      throw new Error('Stop the worker before preparing the recovery operation');
    }
    preparedRecovery = true;
    report('recovery_pending', { instanceId });
  } else {
    const running = await poll(instanceId, 'running');
    if (!running.url) throw new Error('Running instance has no ingress URL');
    report('running', { instanceId, status: running.status });

    if (mode === 'full') {
      await waitForIngressHealth(running.url);
      const solve = await target(running.url, 'solve');
      const flag = solve.body.trim();
      if (solve.status !== 200 || !/^CTF\{v1_[A-Za-z0-9_-]+\}$/u.test(flag)) {
        throw new Error('Disposable target did not return a derived flag');
      }
      const submitted = await domain('POST', '/v1/submissions', {
        body: { challengeId, instanceId, flag }, expect: 200,
      });
      if (!submitted.correct || submitted.points !== 10) {
        throw new Error('First submission was not awarded exactly once');
      }
      const duplicate = await domain('POST', '/v1/submissions', {
        body: { challengeId, instanceId, flag }, expect: 200,
      });
      if (!duplicate.correct || duplicate.points !== 0) {
        throw new Error('Repeated correct submission awarded points again');
      }
      report('submitted', { correct: true, firstPoints: submitted.points, replayPoints: 0 });

      const idempotencyKey = `phase3-extend-${randomUUID()}`;
      const extended = await domain('POST', `/v1/instances/${instanceId}/extend`, {
        idempotencyKey, expect: 202,
      });
      if (Date.parse(extended.instance.expiresAt) - Date.parse(running.expiresAt) !== 30 * 60_000) {
        throw new Error('Extension did not add 30 minutes');
      }
      if (Date.parse(extended.instance.expiresAt) > Date.parse(running.absoluteExpiresAt)) {
        throw new Error('Extension exceeded the absolute lifetime cap');
      }
      const replay = await domain('POST', `/v1/instances/${instanceId}/extend`, {
        idempotencyKey, expect: 202,
      });
      if (!replay.replayed || replay.operationId !== extended.operationId) {
        throw new Error('Extension idempotency replay changed the operation');
      }
      report('extended', { instanceId, expiresAt: extended.instance.expiresAt });
    }

    await destroy(instanceId);
    cleanedUp = true;
    await pollTargetGone(running.url);
    report('destroyed', { instanceId, status: 'stopped', ingressStatus: 404 });
  }
} catch (error) {
  if (instanceId && !cleanedUp && !preparedRecovery && identity) {
    await destroy(instanceId).catch(() => undefined);
  }
  throw error;
} finally {
  if (sessionToken) {
    await api('POST', '/v1/auth/logout', {
      bearer: bffSecret, body: { sessionToken }, expect: 204,
    }).catch(() => undefined);
  }
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function isLoopback(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

function report(step, details) {
  process.stdout.write(`${JSON.stringify({ step, ...details })}\n`);
}

async function token() {
  return new SignJWT({ sid: identity.sessionId, scope: 'instances:read instances:write submissions:write' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(identity.userId)
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode(signingSecret));
}

async function domain(method, path, options) {
  return api(method, path, { ...options, bearer: await token() });
}

async function api(method, path, { bearer, body, idempotencyKey, expect }) {
  const headers = { authorization: `Bearer ${bearer}` };
  if (body) headers['content-type'] = 'application/json';
  if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;
  const response = await fetch(new URL(path, apiBase), {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (response.status !== expect) {
    const failure = await response.json().catch(() => ({}));
    throw new Error(`${method} ${path} returned ${response.status} ${failure.code ?? ''}`.trim());
  }
  return response.status === 204 ? null : response.json();
}

async function poll(id, expected) {
  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline) {
    const view = await domain('GET', `/v1/instances/${id}`, { expect: 200 });
    if (view.status === expected) return view;
    if (view.status === 'failed' || view.status === 'expired') {
      throw new Error(`Instance entered ${view.status} while waiting for ${expected}`);
    }
    await delay(2_000);
  }
  throw new Error(`Instance did not reach ${expected} within 150 seconds`);
}

async function destroy(id) {
  const idempotencyKey = `phase3-destroy-${randomUUID()}`;
  const destroyed = await domain('DELETE', `/v1/instances/${id}`, {
    idempotencyKey, expect: 202,
  });
  if (!destroyed.replayed && destroyed.instance.status !== 'stopping') {
    throw new Error('Destroy did not enter stopping');
  }
  const replay = await domain('DELETE', `/v1/instances/${id}`, {
    idempotencyKey, expect: 202,
  });
  if (!replay.replayed || replay.operationId !== destroyed.operationId) {
    throw new Error('Destroy idempotency replay changed the operation');
  }
  await poll(id, 'stopped');
}

async function pollTargetGone(url) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if ((await target(url, 'health')).status === 404) return;
    await delay(500);
  }
  throw new Error('Ingress route remained after destruction');
}

async function waitForIngressHealth(url) {
  const deadline = Date.now() + 15_000;
  let lastStatus;
  while (Date.now() < deadline) {
    const health = await target(url, 'health');
    if (health.status === 200 && health.body === 'ok\n') return;
    lastStatus = health.status;
    await delay(500);
  }
  throw new Error(`Ingress health request failed after 15 seconds (HTTP ${lastStatus})`);
}

async function target(instanceUrl, path) {
  const route = new URL(instanceUrl);
  if (route.origin !== ingressBase.origin || !route.pathname.startsWith('/labs/')) {
    throw new Error('Instance URL is outside the disposable ingress');
  }
  const url = new URL(path, route);
  const allowSelfSigned = process.env.PHASE3_ALLOW_LOCAL_SELF_SIGNED === 'true';
  return new Promise((resolve, reject) => {
    const request = httpsRequest(url, {
      rejectUnauthorized: !allowSelfSigned,
      timeout: 10_000,
    }, async (response) => {
      try {
        let body = '';
        for await (const chunk of response) {
          body += chunk.toString();
          if (body.length > 1_024) throw new Error('Target response exceeded 1 KiB');
        }
        resolve({ status: response.statusCode, body });
      } catch (error) {
        reject(error);
      }
    });
    request.on('timeout', () => request.destroy(new Error('Ingress request timed out')));
    request.on('error', reject);
    request.end();
  });
}
