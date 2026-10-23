import type { Config } from '../config.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import { verifyServiceToken, type ServiceIdentity } from './service-token.js';

export type ServiceSessionAuthorizer = {
  validateServiceSession: (
    userId: string,
    sessionId: string,
  ) => Promise<{ allowedScopes: string[]; user?: { emailVerified: boolean } }>;
};

/**
 * Resolves the caller's identity from a Bearer token, or rejects.
 *
 * The returned identity is the only acceptable source of a user id — routes
 * must never read one from a request body (AGENTS.md). The reason a token
 * failed (signature, issuer, audience, expiry, missing scope) stays server-side.
 */
export async function requireScope(
  authorizationHeader: string | undefined,
  config: Config,
  scope: string,
  sessionAuthorizer: ServiceSessionAuthorizer,
  requirements: { verifiedEmail?: boolean } = {},
): Promise<ServiceIdentity> {
  if (!authorizationHeader?.startsWith('Bearer ')) throw unauthorized();
  let identity: ServiceIdentity;
  let session: Awaited<ReturnType<ServiceSessionAuthorizer['validateServiceSession']>>;
  try {
    identity = await verifyServiceToken(authorizationHeader.slice(7), config, scope);
    session = await sessionAuthorizer.validateServiceSession(
      identity.userId,
      identity.sessionId,
    );
    if (!session.allowedScopes.includes(scope)) throw new Error('Scope is not allowed by current role');
  } catch {
    throw unauthorized('Invalid or expired token');
  }
  // Read verification from the live session's account, never from signed token claims.
  // An injected authorizer without account state must also fail closed for creation.
  if (requirements.verifiedEmail && session.user?.emailVerified !== true) {
    throw forbidden('Verify your email before creating an instance');
  }
  return identity;
}
