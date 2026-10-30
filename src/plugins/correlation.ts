import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { FastifyInstance } from 'fastify';

export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * A v4 UUID and nothing else.
 *
 * Fastify's own docs warn that trusting an inbound request-id header lets a
 * caller set `reqId` to an arbitrary value, which is a log-forging primitive —
 * so `requestIdHeader` is left at its secure Fastify 5 default (`false`) and
 * the header is read here instead, through this validator. Bounded length and
 * charset mean a hostile value cannot inject newlines or bloat a log line.
 */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Reuses the frontend's request id when it is well-formed, so one id spans both
 * services in the logs; otherwise mints a fresh one.
 */
export function generateRequestId(req: IncomingMessage): string {
  const supplied = req.headers[REQUEST_ID_HEADER];
  const candidate = Array.isArray(supplied) ? supplied[0] : supplied;
  return candidate !== undefined && UUID_V4.test(candidate) ? candidate : randomUUID();
}

/**
 * Echoes the correlation id on every response, including errors, so a user can
 * quote it from their browser's network tab and it will match the server log.
 */
export function registerCorrelation(app: FastifyInstance): void {
  app.addHook('onRequest', async (request, reply) => {
    void reply.header(REQUEST_ID_HEADER, request.id);
  });
}
