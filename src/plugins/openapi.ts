import swagger from '@fastify/swagger';
import type { FastifyInstance } from 'fastify';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';

/** Register before routes so their validation schemas also become the API contract. */
export async function registerOpenApi(app: FastifyInstance): Promise<void> {
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(swagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: 'Cyber Range Backend',
        version: '0.1.0',
        description: 'Cyber Range API with backend-owned authentication and Phase 0 mock domain routes.',
      },
      components: {
        securitySchemes: {
          serviceToken: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
          bffAuth: { type: 'http', scheme: 'bearer' },
        },
      },
    },
    transform: jsonSchemaTransform,
  });

  app.get('/v1/openapi.json', { schema: { hide: true } }, async () => app.swagger());
}
