import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errorResponses } from './schemas.js';

export async function registerMetaRoutes(app: FastifyInstance) {
  app.withTypeProvider<ZodTypeProvider>().get('/meta', {
    schema: {
      operationId: 'getMetadata',
      tags: ['System'],
      response: {
        ...errorResponses,
        200: z.object({ name: z.literal('cyber-range-backend'), version: z.literal('v1') }),
      },
    },
  }, async () => ({ name: 'cyber-range-backend' as const, version: 'v1' as const }));
}
