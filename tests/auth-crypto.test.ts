import { describe, expect, it } from 'vitest';
import { createOpaqueToken, hashOpaqueToken } from '../src/auth/opaque-token.js';
import { createPasswordHasher } from '../src/auth/password.js';

const testPasswordHasher = createPasswordHasher({
  memoryCost: 4 * 1024,
  timeCost: 1,
  parallelism: 1,
  hashLength: 32,
});

describe('authentication cryptography', () => {
  it('hashes and verifies passwords with Argon2id', async () => {
    const password = 'correct horse battery staple';
    const passwordHash = await testPasswordHasher.hash(password);

    expect(passwordHash).toMatch(/^\$argon2id\$/u);
    expect(passwordHash).not.toContain(password);
    await expect(testPasswordHasher.verify(passwordHash, password)).resolves.toBe(true);
    await expect(testPasswordHasher.verify(passwordHash, 'wrong password')).resolves.toBe(false);
  });

  it('creates independent 256-bit opaque tokens and stores only SHA-256 hashes', () => {
    const first = createOpaqueToken();
    const second = createOpaqueToken();

    expect(first.value).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(first.hash).toMatch(/^[a-f0-9]{64}$/u);
    expect(first.hash).toBe(hashOpaqueToken(first.value));
    expect(first.hash).not.toContain(first.value);
    expect(second.value).not.toBe(first.value);
    expect(second.hash).not.toBe(first.hash);
  });
});
