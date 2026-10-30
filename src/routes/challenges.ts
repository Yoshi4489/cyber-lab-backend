import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { notFound } from '../lib/errors.js';
import { errorResponses } from './schemas.js';
import type { CatalogRepository } from '../services/catalog-repository.js';

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
 * Read-only catalog served from published PostgreSQL rows.
 *
 * Public on purpose: it carries no user data and no flags, and the frontend
 * needs it without an account. The response contains only public metadata.
 */
export async function registerChallengeRoutes(
  app: FastifyInstance,
  options: { catalog: CatalogRepository },
) {
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
  }, async () => ({ categories: await options.catalog.listCategories() }));

  routes.get('/challenges', {
    schema: {
      operationId: 'listChallenges',
      tags: ['Catalog'],
      response: {
        ...errorResponses,
        200: z.object({ challenges: z.array(challenge).readonly(), source: z.literal('database') }),
      },
    },
  }, async () => ({
    challenges: await options.catalog.listPublishedChallenges(),
    source: 'database' as const,
  }));

  routes.get('/challenges/:slug', {
    schema: {
      operationId: 'getChallenge',
      tags: ['Catalog'],
      params: slugParams,
      response: { ...errorResponses, 200: challenge },
    },
  }, async (request) => {
    const found = await options.catalog.findPublishedChallengeBySlug(request.params.slug);
    if (found === null) throw notFound('Challenge not found');

    return found;
  });
}
