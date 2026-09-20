import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Config } from '../config.js';
import { requireScope } from '../auth/require-scope.js';
import { flagMatches } from '../lib/flags.js';
import { invalidRequest, notFound } from '../lib/errors.js';
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
  app.post('/submissions', async (request) => {
    await requireScope(request.headers.authorization, options.config, 'submissions:write');

    const parsed = submissionBody.safeParse(request.body);
    if (!parsed.success) {
      throw invalidRequest('Body must be { challengeId: uuid, flag: string }');
    }

    const challenge = findMockChallengeById(parsed.data.challengeId);
    if (challenge === undefined) throw notFound('Challenge not found');

    const correct = flagMatches(parsed.data.flag, mockFlagHash(challenge.slug));

    return {
      correct,
      points: correct ? challenge.points : 0,
      recorded: false,
      source: 'mock' as const,
    };
  });
}
