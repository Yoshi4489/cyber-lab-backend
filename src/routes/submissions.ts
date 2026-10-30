import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Config } from '../config.js';
import { requireScope, type ServiceSessionAuthorizer } from '../auth/require-scope.js';
import type { ServiceIdentity } from '../auth/service-token.js';
import { notImplemented, rateLimited, unauthorized } from '../lib/errors.js';
import type { SubmissionService } from '../services/submissions.js';
import type { UserRateLimiter } from '../services/user-rate-limiter.js';
import { errorResponses, serviceTokenSecurity } from './schemas.js';

const submissionBody = z
  .object({
    challengeId: z.uuid(),
    instanceId: z.uuid(),
    flag: z.string().min(1).max(256),
  })
  .strict();

/**
 * Instance-bound flag verification and transaction-safe scoring.
 * The submitted flag is never persisted, echoed, audited, or logged.
 */
export async function registerSubmissionRoutes(
  app: FastifyInstance,
  options: {
    config: Config;
    sessionAuthorizer: ServiceSessionAuthorizer;
    submissions?: SubmissionService;
    rateLimiter: UserRateLimiter;
  },
) {
  const identities = new WeakMap<object, ServiceIdentity>();
  app.withTypeProvider<ZodTypeProvider>().post('/submissions', {
    // Authenticate before schema validation, preserving the existing rejection order.
    preValidation: async (request) => {
      const identity = await requireScope(
        request.headers.authorization,
        options.config,
        'submissions:write',
        options.sessionAuthorizer,
      );
      if (!options.rateLimiter.consume(identity.userId)) throw rateLimited();
      identities.set(request, identity);
    },
    schema: {
      operationId: 'submitFlag',
      tags: ['Submissions'],
      description: 'Requires submissions:write and an owned running challenge instance.',
      security: serviceTokenSecurity,
      body: submissionBody,
      response: {
        ...errorResponses,
        200: z.object({
          correct: z.boolean(),
          points: z.number().int().nonnegative(),
          recorded: z.literal(true),
          source: z.literal('database'),
        }),
      },
    },
  }, async (request) => {
    const identity = identities.get(request);
    if (!identity) throw unauthorized();
    if (!options.submissions) {
      throw notImplemented('Dynamic submissions require the instance lifecycle');
    }

    return options.submissions.submit({
      userId: identity.userId,
      challengeId: request.body.challengeId,
      instanceId: request.body.instanceId,
      flag: request.body.flag,
      correlationId: request.id,
    });
  });
}
