import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { invalidRequest, notFound } from '../lib/errors.js';
import {
  MOCK_CATEGORIES,
  MOCK_CHALLENGES,
  findMockChallengeBySlug,
} from '../mocks/challenges.js';

const slugParams = z.object({ slug: z.string().min(1).max(64) });

/**
 * Read-only catalog served from the mock fixtures.
 *
 * Public on purpose: it carries no user data and no flags, and the frontend
 * needs it to build screens before accounts exist. Phase 2 swaps the fixture
 * import for database queries; the response shape does not change.
 */
export async function registerChallengeRoutes(app: FastifyInstance) {
  app.get('/categories', async () => ({ categories: MOCK_CATEGORIES }));

  app.get('/challenges', async () => ({
    challenges: MOCK_CHALLENGES,
    source: 'mock' as const,
  }));

  app.get('/challenges/:slug', async (request) => {
    const params = slugParams.safeParse(request.params);
    if (!params.success) throw invalidRequest('Slug must be 1-64 characters');

    const challenge = findMockChallengeBySlug(params.data.slug);
    if (challenge === undefined) throw notFound('Challenge not found');

    return challenge;
  });
}
