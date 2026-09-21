import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { requireScope } from '../src/auth/require-scope.js';
import { verifyServiceToken } from '../src/auth/service-token.js';
import { signToken, testConfig } from './helpers.js';

describe('service token session claims', () => {
  it('requires a backend session id in every user token', async () => {
    const token = await new SignJWT({ scope: 'submissions:write' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('player-1')
      .setIssuer(testConfig.SERVICE_TOKEN_ISSUER)
      .setAudience(testConfig.SERVICE_TOKEN_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode(testConfig.BACKEND_SERVICE_TOKEN_SECRET));

    await expect(
      verifyServiceToken(token, testConfig, 'submissions:write'),
    ).rejects.toThrow('Invalid service token claims');
  });

  it('checks the current account role after verifying the signed scope', async () => {
    const token = await signToken('admin:write');

    await expect(
      requireScope(
        `Bearer ${token}`,
        testConfig,
        'admin:write',
        {
          validateServiceSession: async () => ({
            allowedScopes: ['submissions:write'],
          }),
        },
      ),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});
