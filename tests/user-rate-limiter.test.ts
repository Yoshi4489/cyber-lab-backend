import { describe, expect, it } from 'vitest';
import { FixedWindowUserRateLimiter } from '../src/services/user-rate-limiter.js';

describe('verified-user rate limiter', () => {
  it('isolates users and resets after the configured window', () => {
    let now = 1_000;
    const limiter = new FixedWindowUserRateLimiter(2, 500, () => now);

    expect(limiter.consume('player-a')).toBe(true);
    expect(limiter.consume('player-a')).toBe(true);
    expect(limiter.consume('player-a')).toBe(false);
    expect(limiter.consume('player-b')).toBe(true);

    now += 500;
    expect(limiter.consume('player-a')).toBe(true);
  });
});
