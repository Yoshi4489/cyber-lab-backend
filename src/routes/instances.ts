import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Config } from '../config.js';
import { requireScope } from '../auth/require-scope.js';
import { notImplemented } from '../lib/errors.js';
import { errorBody, errorResponses, serviceTokenSecurity } from './schemas.js';

const instanceParams = z.object({ id: z.uuid() });
const createBody = z.object({ challengeId: z.uuid() }).strict();

export async function registerInstanceRoutes(
  app: FastifyInstance,
  options: { config: Config },
) {
  const routes = app.withTypeProvider<ZodTypeProvider>();
  const response = { ...errorResponses, 501: errorBody };

  function authorize(scope: string) {
    return async (request: FastifyRequest): Promise<void> => {
      await requireScope(request.headers.authorization, options.config, scope);
    };
  }

  const ownedInstanceSchema = {
    tags: ['Instances'],
    security: serviceTokenSecurity,
    params: instanceParams,
    response,
  };

  async function unfinished(): Promise<never> {
    throw notImplemented('Instance lifecycle ships in Phase 3');
  }

  routes.post('/instances', {
    preValidation: authorize('instances:write'),
    schema: {
      operationId: 'createInstance',
      tags: ['Instances'],
      description: 'Requires instances:write. Returns 501 until Phase 3.',
      security: serviceTokenSecurity,
      body: createBody,
      response,
    },
  }, async () => {
    throw notImplemented('Instance provisioning ships in Phase 3');
  });

  routes.get('/instances/:id', {
    preValidation: authorize('instances:read'),
    schema: {
      ...ownedInstanceSchema,
      operationId: 'getInstance',
      description: 'Requires instances:read. Returns 501 until Phase 3.',
    },
  }, unfinished);

  routes.post('/instances/:id/extend', {
    preValidation: authorize('instances:write'),
    schema: {
      ...ownedInstanceSchema,
      operationId: 'extendInstance',
      description: 'Requires instances:write. Returns 501 until Phase 3.',
    },
  }, unfinished);

  routes.delete('/instances/:id', {
    preValidation: authorize('instances:write'),
    schema: {
      ...ownedInstanceSchema,
      operationId: 'destroyInstance',
      description: 'Requires instances:write. Returns 501 until Phase 3.',
    },
  }, unfinished);
}
