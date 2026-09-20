import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Config } from '../config.js';
import { requireScope } from '../auth/require-scope.js';
import { invalidRequest, notImplemented } from '../lib/errors.js';

const instanceParams = z.object({ id: z.uuid() });
const createBody = z.object({ challengeId: z.uuid() }).strict();

export async function registerInstanceRoutes(
  app: FastifyInstance,
  options: { config: Config },
) {
  app.post('/instances', async (request) => {
    await requireScope(request.headers.authorization, options.config, 'instances:write');
    if (!createBody.safeParse(request.body).success) {
      throw invalidRequest('Body must be { challengeId: uuid }');
    }
    throw notImplemented('Instance provisioning ships in Phase 3');
  });

  async function instanceOperation(request: FastifyRequest, scope: string): Promise<never> {
    await requireScope(request.headers.authorization, options.config, scope);
    if (!instanceParams.safeParse(request.params).success) {
      throw invalidRequest('Instance id must be a uuid');
    }
    throw notImplemented('Instance lifecycle ships in Phase 3');
  }

  app.get('/instances/:id', (request) => instanceOperation(request, 'instances:read'));
  app.post('/instances/:id/extend', (request) => instanceOperation(request, 'instances:write'));
  app.delete('/instances/:id', (request) => instanceOperation(request, 'instances:write'));
}
