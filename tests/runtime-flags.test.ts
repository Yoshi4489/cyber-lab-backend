import { describe, expect, it } from 'vitest';
import { WELCOME_CHALLENGE_ID } from '../src/catalog/definitions.js';
import { HmacInstanceFlagService } from '../src/services/instance-flags.js';
import { createRuntimeFlagDeriver, createSubmissionFlagPolicy } from '../src/services/runtime-flags.js';
import { loadWelcomeLabConfig, WELCOME_LAB_PUBLIC_FLAG } from '../src/welcome-lab-config.js';

const secret = 'runtime-flag-test-secret-at-least-thirty-two-characters';
const dynamic = new HmacInstanceFlagService(secret);
const context = { userId: 'user-a', challengeId: WELCOME_CHALLENGE_ID, instanceId: 'instance-a' };
const enabled = loadWelcomeLabConfig({
  NODE_ENV: 'test', WELCOME_LAB_TEST_ENABLED: 'true', WELCOME_LAB_FLAG: WELCOME_LAB_PUBLIC_FLAG,
});

describe('worker-only Welcome runtime flag injection', () => {
  it('keeps dynamic derivation for every challenge when disabled', () => {
    const runtime = createRuntimeFlagDeriver(secret, loadWelcomeLabConfig({}));
    expect(runtime.derive(context)).toBe(dynamic.derive(context));
    expect(runtime.derive({ ...context, userId: 'user-b' })).not.toBe(runtime.derive(context));
  });

  it('injects the configured public value only for the exact Welcome identity', () => {
    const runtime = createRuntimeFlagDeriver(secret, enabled);
    expect(runtime.derive(context)).toBe(WELCOME_LAB_PUBLIC_FLAG);
    expect(runtime.derive({ ...context, userId: 'user-b', instanceId: 'instance-b' })).toBe(WELCOME_LAB_PUBLIC_FLAG);
    for (const challengeId of ['11111111-1111-4111-8111-111111111111', 'welcome', WELCOME_CHALLENGE_ID.toUpperCase().replace('88888888', '88888889')]) {
      const other = { ...context, challengeId };
      expect(runtime.derive(other)).toBe(dynamic.derive(other));
      expect(runtime.derive(other)).not.toBe(WELCOME_LAB_PUBLIC_FLAG);
    }
  });

  it('provides no verifier from the worker deriver', () => {
    const runtime = createRuntimeFlagDeriver(secret, enabled);
    expect(Object.keys(runtime)).toEqual(['derive']);
    expect(dynamic.verify(context, WELCOME_LAB_PUBLIC_FLAG)).toBe(false);
    expect(dynamic.verify(context, dynamic.derive(context))).toBe(true);
  });

  it('fails closed for missing or changed enabled configuration without echoing its value', () => {
    for (const WELCOME_LAB_FLAG of [undefined, 'incorrect-test-marker']) {
      const config = WELCOME_LAB_FLAG === undefined
        ? { WELCOME_LAB_TEST_ENABLED: true }
        : { WELCOME_LAB_TEST_ENABLED: true, WELCOME_LAB_FLAG };
      expect(() => createRuntimeFlagDeriver(secret, config as typeof enabled)).toThrow('Invalid Welcome runtime configuration');
    }
    expect(() => createRuntimeFlagDeriver('weak', enabled)).toThrow('at least 32 bytes');
  });
});

describe('API Welcome submission verification', () => {
  const other = { ...context, challengeId: '11111111-1111-4111-8111-111111111111' };

  it('keeps dynamic verification for every challenge when disabled', () => {
    const policy = createSubmissionFlagPolicy(secret, loadWelcomeLabConfig({}));
    expect(policy.verify(context, WELCOME_LAB_PUBLIC_FLAG)).toBe(false);
    expect(policy.verify(context, dynamic.derive(context))).toBe(true);
    expect(policy.verify(other, dynamic.derive(other))).toBe(true);
  });

  it('accepts the shared value only for the exact Welcome identity when enabled', () => {
    const policy = createSubmissionFlagPolicy(secret, enabled);
    expect(policy.verify(context, WELCOME_LAB_PUBLIC_FLAG)).toBe(true);
    expect(policy.verify({ ...context, userId: 'user-b', instanceId: 'instance-b' }, WELCOME_LAB_PUBLIC_FLAG)).toBe(true);
    expect(policy.verify(context, ` \t${WELCOME_LAB_PUBLIC_FLAG}\n`)).toBe(true);
    for (const wrong of [WELCOME_LAB_PUBLIC_FLAG.toLowerCase(), `${WELCOME_LAB_PUBLIC_FLAG}x`, '', dynamic.derive(context)]) {
      expect(policy.verify(context, wrong)).toBe(false);
    }
  });

  it('never uses the Welcome value as a fallback for other challenges', () => {
    const policy = createSubmissionFlagPolicy(secret, enabled);
    for (const challengeId of [other.challengeId, 'welcome', WELCOME_CHALLENGE_ID.replace('88888888', '88888889')]) {
      const candidate = { ...context, challengeId };
      expect(policy.verify(candidate, WELCOME_LAB_PUBLIC_FLAG)).toBe(false);
      expect(policy.verify(candidate, dynamic.derive(candidate))).toBe(true);
    }
  });

  it('derives exactly what the worker injects', () => {
    const policy = createSubmissionFlagPolicy(secret, enabled);
    const runtime = createRuntimeFlagDeriver(secret, enabled);
    for (const candidate of [context, other]) {
      expect(policy.derive(candidate)).toBe(runtime.derive(candidate));
    }
  });

  it('fails closed for changed enabled configuration', () => {
    const changed = { WELCOME_LAB_TEST_ENABLED: true, WELCOME_LAB_FLAG: 'incorrect-test-marker' };
    expect(() => createSubmissionFlagPolicy(secret, changed as typeof enabled)).toThrow('Invalid Welcome runtime configuration');
    expect(() => createSubmissionFlagPolicy('weak', enabled)).toThrow('at least 32 bytes');
  });
});
