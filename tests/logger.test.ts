import { describe, expect, it } from 'vitest';
import { scrubQuery } from '../src/lib/logger.js';

describe('scrubQuery', () => {
  it('leaves a url without a query string untouched', () => {
    expect(scrubQuery('/v1/challenges')).toBe('/v1/challenges');
  });

  it('keeps parameter names and drops every value', () => {
    expect(scrubQuery('/v1/submissions?flag=CTF{real_flag}&page=2')).toBe(
      '/v1/submissions?flag=<redacted>&page=<redacted>',
    );
  });

  it('drops an empty query string', () => {
    expect(scrubQuery('/v1/challenges?')).toBe('/v1/challenges');
  });

  it('lists a repeated parameter name once', () => {
    expect(scrubQuery('/a?x=1&x=2')).toBe('/a?x=<redacted>');
  });

  it('cannot reintroduce a newline by percent-decoding a value', () => {
    const scrubbed = scrubQuery('/a?note=line1%0Aline2');
    expect(scrubbed).toBe('/a?note=<redacted>');
    expect(scrubbed).not.toContain('\n');
  });

  it('does not keep a token that was passed as a query parameter', () => {
    expect(scrubQuery('/v1/instances?access_token=supersecretvalue')).not.toContain(
      'supersecretvalue',
    );
  });
});
