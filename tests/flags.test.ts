import { describe, expect, it } from 'vitest';
import { flagMatches, hashFlag } from '../src/lib/flags.js';

describe('flag hashing', () => {
  it('produces a sha256 hex digest', () => {
    expect(hashFlag('CTF{example}')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('never contains the flag it hashed', () => {
    expect(hashFlag('CTF{a_very_distinctive_value}')).not.toContain('distinctive');
  });

  it('accepts a flag pasted with surrounding whitespace', () => {
    expect(flagMatches('  CTF{example}\n', hashFlag('CTF{example}'))).toBe(true);
  });

  it('rejects a wrong flag', () => {
    expect(flagMatches('CTF{wrong}', hashFlag('CTF{example}'))).toBe(false);
  });

  it('stays case sensitive', () => {
    expect(flagMatches('ctf{example}', hashFlag('CTF{example}'))).toBe(false);
  });

  it('returns false for a malformed stored hash instead of throwing', () => {
    expect(flagMatches('CTF{example}', '')).toBe(false);
    expect(flagMatches('CTF{example}', 'not-hex')).toBe(false);
  });
});
