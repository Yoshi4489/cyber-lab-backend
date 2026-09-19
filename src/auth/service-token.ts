import { jwtVerify, type JWTPayload } from 'jose';
import type { Config } from '../config.js';

export type ServiceIdentity = { userId: string; scope: string };

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
  if (!payload.sub || typeof payload.scope !== 'string') {
    throw new Error('Invalid service token claims');
  }
  const scopes = payload.scope.split(' ');
  if (!scopes.includes(requiredScope)) {
    throw new Error('Insufficient service token scope');
  }
  return { userId: payload.sub, scope: payload.scope };
}
