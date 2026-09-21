import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { buildLoggerOptions, scrubQuery } from '../src/lib/logger.js';
import { testConfig } from './helpers.js';

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

  it('redacts every authentication credential field from captured logs', async () => {
    const lines: string[] = [];
    const logger = buildLoggerOptions({ ...testConfig, NODE_ENV: 'development' });
    if (!logger || typeof logger !== 'object') {
      throw new Error('Expected development logger options');
    }
    const app = Fastify({
      logger: {
        ...logger,
        stream: { write: (line: string) => lines.push(line) },
      },
    });
    app.post('/capture', async (request) => {
      request.log.info({ payload: request.body }, 'captured authentication payload');
      return { ok: true };
    });

    try {
      await app.inject({
        method: 'POST',
        url: '/capture',
        payload: {
          password: 'login-password-secret',
          newPassword: 'reset-password-secret',
          sessionToken: 'opaque-session-secret',
          token: 'email-token-secret',
        },
      });
    } finally {
      await app.close();
    }

    const output = lines.join('');
    expect(output).toContain('[Redacted]');
    for (const secret of [
      'login-password-secret',
      'reset-password-secret',
      'opaque-session-secret',
      'email-token-secret',
    ]) {
      expect(output).not.toContain(secret);
    }
  });
});
