import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Config } from '../config.js';
import { requireScope } from '../auth/require-scope.js';
import { flagMatches } from '../lib/flags.js';
import { notFound } from '../lib/errors.js';
import { errorResponses, serviceTokenSecurity } from './schemas.js';
import { findMockChallengeById, mockFlagHash } from '../mocks/challenges.js';

const submissionBody = z
  .object({ challengeId: z.uuid(), flag: z.string().min(1).max(256) })
  .strict();

/**
 * Flag verification against the mock fixtures.
 *
 * Nothing is persisted yet — there is no database until Phase 1 — so the
 * response says so explicitly rather than implying a solve was recorded.
 * Phase 2 adds the `submissions`/`solves` rows, a per-user rate limit, and an
 * audit record; the request and response shapes stay the same.
 *
 * The submitted flag is never echoed back and never logged.
 */
export async function registerSubmissionRoutes(
  app: FastifyInstance,
  options: { config: Config },
) {
  app.withTypeProvider<ZodTypeProvider>().post('/submissions', {
    // Authenticate before schema validation, preserving the existing rejection order.
    preValidation: async (request) => {
      await requireScope(request.headers.authorization, options.config, 'submissions:write');
    },
    schema: {
      operationId: 'submitFlag',
      tags: ['Submissions'],
      description: 'Requires submissions:write. Mock verification only; no solve is recorded.',
      security: serviceTokenSecurity,
      body: submissionBody,
      response: {
        ...errorResponses,
        200: z.object({
          correct: z.boolean(),
          points: z.number().int().nonnegative(),
          recorded: z.literal(false),
          source: z.literal('mock'),
        }),
      },
    },
  }, async (request) => {
    const challenge = findMockChallengeById(request.body.challengeId);
    if (challenge === undefined) throw notFound('Challenge not found');

    const correct = flagMatches(request.body.flag, mockFlagHash(challenge.slug));

    return {
      correct,
      points: correct ? challenge.points : 0,
      recorded: false as const,
      source: 'mock' as const,
    };
  });
}
