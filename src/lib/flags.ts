import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Flags are never stored in plaintext — only this digest is (AGENTS.md).
 *
 * Submitted flags are trimmed because players paste them, but comparison stays
 * case-sensitive: a flag is an exact string.
 */
export function hashFlag(flag: string): string {
  return createHash('sha256').update(flag.trim(), 'utf8').digest('hex');
}

/**
 * Constant-time comparison, so response timing cannot be used to recover a
 * flag character by character.
 */
export function flagMatches(submitted: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashFlag(submitted), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  if (actual.length !== expected.length || expected.length === 0) return false;
  return timingSafeEqual(actual, expected);
}
