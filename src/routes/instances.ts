import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Config } from '../config.js';
import { requireScope, type ServiceSessionAuthorizer } from '../auth/require-scope.js';
import type { ServiceIdentity } from '../auth/service-token.js';
import { notImplemented, rateLimited, unauthorized } from '../lib/errors.js';
import {
  INSTANCE_STATUSES,
  type InstanceLifecycleService,
} from '../services/instance-lifecycle.js';
import type { UserRateLimiter } from '../services/user-rate-limiter.js';
import { errorBody, errorResponses, serviceTokenSecurity } from './schemas.js';

const instanceParams = z.object({ id: z.uuid() });
const createBody = z.object({ challengeId: z.uuid() }).strict();
const idempotencyHeaders = z.object({
  'idempotency-key': z.string().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/),
});
const instanceResponse = z.object({
  id: z.uuid(),
  challengeId: z.uuid(),
  status: z.enum(INSTANCE_STATUSES),
  createdAt: z.iso.datetime(),
  startedAt: z.iso.datetime().nullable(),
  expiresAt: z.iso.datetime(),
  absoluteExpiresAt: z.iso.datetime(),
  stoppedAt: z.iso.datetime().nullable(),
  failureCode: z.string().nullable(),
  url: z.url().optional(),
});
const mutationResponse = z.object({
  instance: instanceResponse,
  operationId: z.uuid(),
  replayed: z.boolean(),
});

export async function registerInstanceRoutes(
  app: FastifyInstance,
  options: {
    config: Config;
    sessionAuthorizer: ServiceSessionAuthorizer;
    rateLimiter: UserRateLimiter;
    instances?: InstanceLifecycleService;
  },
) {
  const identities = new WeakMap<object, ServiceIdentity>();
  const routes = app.withTypeProvider<ZodTypeProvider>();
  const response = { ...errorResponses, 501: errorBody };

  function authorize(scope: string, applyRateLimit = false) {
    return async (request: FastifyRequest): Promise<void> => {
      const identity = await requireScope(
        request.headers.authorization,
        options.config,
        scope,
        options.sessionAuthorizer,
      );
      if (applyRateLimit && !options.rateLimiter.consume(identity.userId)) throw rateLimited();
      identities.set(request, identity);
    };
  }

  function identityFor(request: object): ServiceIdentity {
    const identity = identities.get(request);
    if (!identity) throw unauthorized();
    return identity;
  }

  routes.post('/instances', {
    preValidation: authorize('instances:write', true),
    schema: {
      operationId: 'createInstance',
      tags: ['Instances'],
      description: 'Creates owned instance intent. Requires instances:write and Idempotency-Key.',
      security: serviceTokenSecurity,
      headers: idempotencyHeaders,
      body: createBody,
      response: { ...response, 202: mutationResponse },
    },
  }, async (request, reply) => {
    if (!options.instances) throw notImplemented('Instance lifecycle is unavailable');
    const result = await options.instances.create({
      userId: identityFor(request).userId,
      challengeId: request.body.challengeId,
      idempotencyKey: request.headers['idempotency-key'],
      correlationId: request.id,
    });
    return reply.code(202).send(result);
  });

  routes.get('/instances/:id', {
    preValidation: authorize('instances:read'),
    schema: {
      operationId: 'getInstance',
      tags: ['Instances'],
      description: 'Returns an owned instance. Its URL appears only after readiness.',
      security: serviceTokenSecurity,
      params: instanceParams,
      response: { ...response, 200: instanceResponse },
    },
  }, async (request) => {
    if (!options.instances) throw notImplemented('Instance lifecycle is unavailable');
    return options.instances.get(identityFor(request).userId, request.params.id);
  });

  routes.post('/instances/:id/extend', {
    preValidation: authorize('instances:write'),
    schema: {
      operationId: 'extendInstance',
      tags: ['Instances'],
      description: 'Adds 30 minutes without exceeding the two-hour absolute lifetime.',
      security: serviceTokenSecurity,
      headers: idempotencyHeaders,
      params: instanceParams,
      response: { ...response, 202: mutationResponse },
    },
  }, async (request, reply) => {
    if (!options.instances) throw notImplemented('Instance lifecycle is unavailable');
    const result = await options.instances.extend({
      userId: identityFor(request).userId,
      instanceId: request.params.id,
      idempotencyKey: request.headers['idempotency-key'],
      correlationId: request.id,
    });
    return reply.code(202).send(result);
  });

  routes.delete('/instances/:id', {
    preValidation: authorize('instances:write'),
    schema: {
      operationId: 'destroyInstance',
      tags: ['Instances'],
      description: 'Requests retry-safe destruction of an owned instance.',
      security: serviceTokenSecurity,
      headers: idempotencyHeaders,
      params: instanceParams,
      response: { ...response, 202: mutationResponse },
    },
  }, async (request, reply) => {
    if (!options.instances) throw notImplemented('Instance lifecycle is unavailable');
    const result = await options.instances.destroy({
      userId: identityFor(request).userId,
      instanceId: request.params.id,
      idempotencyKey: request.headers['idempotency-key'],
      correlationId: request.id,
    });
    return reply.code(202).send(result);
  });
}
