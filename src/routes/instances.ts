import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Config } from '../config.js';
import { verifyServiceToken } from '../auth/service-token.js';

const instanceParams = z.object({ id: z.uuid() });
const createBody = z.object({ challengeId: z.uuid() }).strict();

export async function registerInstanceRoutes(
  app: FastifyInstance,
  options: { config: Config },
) {
  async function authenticate(header: string | undefined, scope: string) {
    if (!header?.startsWith('Bearer ')) return false;
    try {
      await verifyServiceToken(header.slice(7), options.config, scope);
      return true;
    } catch {
      return false;
    }
  }

  app.post('/instances', async (request, reply) => {
    if (!(await authenticate(request.headers.authorization, 'instances:write'))) {
      return reply.code(401).send({ code: 'UNAUTHORIZED' });
    }
    if (!createBody.safeParse(request.body).success) {
      return reply.code(400).send({ code: 'INVALID_REQUEST' });
    }
    return reply.code(501).send({ code: 'NOT_IMPLEMENTED' });
  });

  async function instanceOperation(
    request: FastifyRequest,
    reply: FastifyReply,
    scope: string,
  ) {
    if (!(await authenticate(request.headers.authorization, scope))) {
      return reply.code(401).send({ code: 'UNAUTHORIZED' });
    }
    if (!instanceParams.safeParse(request.params).success) {
      return reply.code(400).send({ code: 'INVALID_REQUEST' });
    }
    return reply.code(501).send({ code: 'NOT_IMPLEMENTED' });
  }

  app.get('/instances/:id', (request, reply) => instanceOperation(request, reply, 'instances:read'));
  app.post('/instances/:id/extend', (request, reply) => instanceOperation(request, reply, 'instances:write'));
  app.delete('/instances/:id', (request, reply) => instanceOperation(request, reply, 'instances:write'));
}
