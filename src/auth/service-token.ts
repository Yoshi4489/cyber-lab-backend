import { jwtVerify, type JWTPayload } from 'jose';
import type { Config } from '../config.js';

export type ServiceIdentity = { userId: string; sessionId: string; scope: string };

export async function verifyServiceToken(
  token: string,
  config: Config,
  requiredScope: string,
): Promise<ServiceIdentity> {
  const key = new TextEncoder().encode(config.BACKEND_SERVICE_TOKEN_SECRET);
  const { payload } = await jwtVerify(token, key, {
    algorithms: ['HS256'],
    issuer: config.SERVICE_TOKEN_ISSUER,
    audience: config.SERVICE_TOKEN_AUDIENCE,
    requiredClaims: ['sub', 'exp', 'iat'],
    maxTokenAge: '5m',
  });
  return identityFromPayload(payload, requiredScope);
}

function identityFromPayload(payload: JWTPayload, requiredScope: string): ServiceIdentity {
  if (
    !payload.sub ||
    typeof payload.sid !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      payload.sid,
    ) ||
    typeof payload.scope !== 'string'
  ) {
    throw new Error('Invalid service token claims');
  }
  const scopes = payload.scope.split(' ');
  if (!scopes.includes(requiredScope)) {
    throw new Error('Insufficient service token scope');
  }
  return { userId: payload.sub, sessionId: payload.sid, scope: payload.scope };
}
