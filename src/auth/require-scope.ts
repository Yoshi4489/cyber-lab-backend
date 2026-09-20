import type { Config } from '../config.js';
import { unauthorized } from '../lib/errors.js';
import { verifyServiceToken, type ServiceIdentity } from './service-token.js';

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
): Promise<ServiceIdentity> {
  if (!authorizationHeader?.startsWith('Bearer ')) throw unauthorized();
  try {
    return await verifyServiceToken(authorizationHeader.slice(7), config, scope);
  } catch {
    throw unauthorized('Invalid or expired token');
  }
}
