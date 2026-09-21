import { createHash, timingSafeEqual } from 'node:crypto';
import type { Config } from '../config.js';
import { unauthorized } from '../lib/errors.js';

export function requireBff(
  authorizationHeader: string | undefined,
  config: Config,
): void {
  if (!authorizationHeader?.startsWith('Bearer ')) throw unauthorized();

  const presented = createHash('sha256').update(authorizationHeader.slice(7)).digest();
  const expected = createHash('sha256').update(config.BFF_AUTH_SECRET).digest();
  if (!timingSafeEqual(presented, expected)) {
    throw unauthorized('Invalid BFF credential');
  }
}
