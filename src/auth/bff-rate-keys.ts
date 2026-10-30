import { createHash } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';

/** Set by the frontend BFF to the learner's address it observed. */
export const BFF_CLIENT_IP_HEADER = 'x-cyber-range-client-ip';

const clientIpSchema = z.union([z.ipv4(), z.ipv6()]);

/**
 * Rate-limit keys for BFF-only auth routes. They run as `preHandler` hooks,
 * after `requireBff` has verified the BFF credential, so the forwarded client
 * address is trusted only from the authenticated BFF. A missing or malformed
 * address falls back to the BFF's own address, which is the stricter shared key.
 */
export function bffClientKey(request: FastifyRequest): string {
  const parsed = clientIpSchema.safeParse(request.headers[BFF_CLIENT_IP_HEADER]);
  return `client:${parsed.success ? parsed.data : request.ip}`;
}

/** Keys per opaque session, hashed so the raw token never enters the store. */
export function bffSessionKey(request: FastifyRequest): string {
  const token = (request.body as { sessionToken?: unknown } | undefined)?.sessionToken;
  if (typeof token !== 'string') return bffClientKey(request);
  return `session:${createHash('sha256').update(token, 'utf8').digest('base64url')}`;
}
