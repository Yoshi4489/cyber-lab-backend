import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Config } from '../config.js';
import { requireScope, type ServiceSessionAuthorizer } from '../auth/require-scope.js';
import type { ServiceIdentity } from '../auth/service-token.js';
import { notFound, unauthorized } from '../lib/errors.js';
import type { ProgressRepository } from '../services/progress-repository.js';
import { errorResponses, serviceTokenSecurity } from './schemas.js';

const solveSchema = z.object({
  challengeId: z.uuid(),
  slug: z.string(),
  title: z.string(),
  points: z.number().int().positive(),
  solvedAt: z.iso.datetime(),
});

const unavailableProgress: ProgressRepository = {
  getPlayerProgress: () => Promise.reject(new Error('Progress repository unavailable')),
  listLeaderboard: () => Promise.reject(new Error('Progress repository unavailable')),
};

export async function registerProgressRoutes(
  app: FastifyInstance,
  options: {
    config: Config;
    sessionAuthorizer: ServiceSessionAuthorizer;
    progress?: ProgressRepository;
  },
) {
  const repository = options.progress ?? unavailableProgress;
  const identities = new WeakMap<object, ServiceIdentity>();
  const routes = app.withTypeProvider<ZodTypeProvider>();

  routes.get('/profile', {
    preValidation: async (request) => {
      const identity = await requireScope(
        request.headers.authorization,
        options.config,
        'profile:read',
        options.sessionAuthorizer,
      );
      identities.set(request, identity);
    },
    schema: {
      operationId: 'getCurrentPlayerProfile',
      tags: ['Progress'],
      description: 'Requires profile:read. Identity comes from the verified service token.',
      security: serviceTokenSecurity,
      response: {
        ...errorResponses,
        200: z.object({
          userId: z.uuid(),
          displayName: z.string(),
          bio: z.string().nullable(),
          totalPoints: z.number().int().nonnegative(),
          solvedCount: z.number().int().nonnegative(),
          availableChallenges: z.number().int().nonnegative(),
          solves: z.array(solveSchema),
        }),
      },
    },
  }, async (request) => {
    const identity = identities.get(request);
    if (!identity) throw unauthorized();
    const progress = await repository.getPlayerProgress(identity.userId);
    if (!progress) throw notFound('Player profile not found');
    return {
      ...progress,
      solves: progress.solves.map((solve) => ({
        ...solve,
        solvedAt: solve.solvedAt.toISOString(),
      })),
    };
  });

  routes.get('/leaderboard', {
    schema: {
      operationId: 'getLeaderboard',
      tags: ['Progress'],
      response: {
        ...errorResponses,
        200: z.object({
          entries: z.array(z.object({
            rank: z.number().int().positive(),
            displayName: z.string(),
            totalPoints: z.number().int().nonnegative(),
            solvedCount: z.number().int().nonnegative(),
            lastSolvedAt: z.iso.datetime().nullable(),
          })),
          source: z.literal('database'),
        }),
      },
    },
  }, async () => ({
    entries: (await repository.listLeaderboard(100)).map((entry) => ({
      ...entry,
      lastSolvedAt: entry.lastSolvedAt?.toISOString() ?? null,
    })),
    source: 'database' as const,
  }));
}
