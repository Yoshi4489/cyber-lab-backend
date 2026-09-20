import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { notFound } from '../lib/errors.js';
import { errorResponses } from './schemas.js';
import {
  MOCK_CATEGORIES,
  MOCK_CHALLENGES,
  findMockChallengeBySlug,
} from '../mocks/challenges.js';

const slugParams = z.object({ slug: z.string().min(1).max(64) });
const challenge = z.object({
  id: z.uuid(),
  slug: z.string(),
  title: z.string(),
  summary: z.string(),
  category: z.string(),
  difficulty: z.enum(['easy', 'medium', 'hard']),
  points: z.number().int().nonnegative(),
  kind: z.enum(['web', 'shell']),
  tags: z.array(z.string()).readonly(),
});

/**
 * Read-only catalog served from the mock fixtures.
 *
 * Public on purpose: it carries no user data and no flags, and the frontend
 * needs it to build screens before accounts exist. Phase 2 swaps the fixture
 * import for database queries; the response shape does not change.
 */
export async function registerChallengeRoutes(app: FastifyInstance) {
  const routes = app.withTypeProvider<ZodTypeProvider>();
  routes.get('/categories', {
    schema: {
      operationId: 'listCategories',
      tags: ['Catalog'],
      response: {
        ...errorResponses,
        200: z.object({ categories: z.array(z.string()).readonly() }),
      },
    },
  }, async () => ({ categories: MOCK_CATEGORIES }));

  routes.get('/challenges', {
    schema: {
      operationId: 'listChallenges',
      tags: ['Catalog'],
      response: {
        ...errorResponses,
        200: z.object({ challenges: z.array(challenge).readonly(), source: z.literal('mock') }),
      },
    },
  }, async () => ({
    challenges: MOCK_CHALLENGES,
    source: 'mock' as const,
  }));

  routes.get('/challenges/:slug', {
    schema: {
      operationId: 'getChallenge',
      tags: ['Catalog'],
      params: slugParams,
      response: { ...errorResponses, 200: challenge },
    },
  }, async (request) => {
    const found = findMockChallengeBySlug(request.params.slug);
    if (found === undefined) throw notFound('Challenge not found');

    return found;
  });
}
