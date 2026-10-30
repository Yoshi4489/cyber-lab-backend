import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireScope, type ServiceSessionAuthorizer } from '../auth/require-scope.js';
import type { ServiceIdentity } from '../auth/service-token.js';
import type { Config } from '../config.js';
import { notFound, rateLimited, unauthorized } from '../lib/errors.js';
import { errorResponses, serviceTokenSecurity } from './schemas.js';
import type { CatalogRepository } from '../services/catalog-repository.js';
import { ARTIFACT_FILENAME, type ArtifactStore } from '../services/artifact-store.js';
import type { ChallengeContentRepository } from '../services/challenge-content.js';
import type { UserRateLimiter } from '../services/user-rate-limiter.js';

const slugParams = z.object({ slug: z.string().min(1).max(64) });
const challenge = z.object({
  id: z.uuid(),
  slug: z.string(),
  title: z.string(),
  summary: z.string(),
  category: z.string(),
  difficulty: z.enum(['easy', 'medium', 'hard']),
  points: z.number().int().nonnegative(),
  kind: z.enum(['web', 'shell', 'artifact']),
  tags: z.array(z.string()).readonly(),
});
const contentSchema = z.object({
  briefingMd: z.string(),
  objectives: z.array(z.string()),
  learningOutcomes: z.array(z.string()),
  references: z.array(z.object({ label: z.string(), url: z.string().optional() })),
  hints: z.array(z.object({ position: z.number().int().positive(), cost: z.number().int().nonnegative() })),
  hasWalkthrough: z.boolean(),
  artifacts: z.array(z.object({
    filename: z.string(),
    sizeBytes: z.number().int().nonnegative(),
    sha256: z.string(),
  })),
});
const stateSchema = z.object({
  solved: z.boolean(),
  pointsAwarded: z.number().int().nonnegative().nullable(),
  costApplied: z.number().int().nonnegative(),
  forfeited: z.boolean(),
  unlockedHints: z.array(z.object({
    position: z.number().int().positive(),
    bodyMd: z.string(),
    costApplied: z.number().int().nonnegative(),
  })),
  walkthroughMd: z.string().nullable(),
});

/**
 * Read-only catalog served from published PostgreSQL rows.
 *
 * Public on purpose: it carries no user data and no flags, and the frontend
 * needs it without an account. The response contains only public metadata.
 */
export async function registerChallengeRoutes(
  app: FastifyInstance,
  options: {
    catalog: CatalogRepository;
    content: ChallengeContentRepository;
    artifacts: ArtifactStore;
    config: Config;
    sessionAuthorizer: ServiceSessionAuthorizer;
    rateLimiter: UserRateLimiter;
  },
) {
  const routes = app.withTypeProvider<ZodTypeProvider>();
  const identities = new WeakMap<object, ServiceIdentity>();
  const authenticate = (scope: string, limited = scope === 'submissions:write') => async (request: FastifyRequest) => {
    const identity = await requireScope(
      request.headers.authorization,
      options.config,
      scope,
      options.sessionAuthorizer,
    );
    if (limited && !options.rateLimiter.consume(identity.userId)) {
      throw rateLimited();
    }
    identities.set(request, identity);
  };
  const identityOf = (request: FastifyRequest): string => {
    const identity = identities.get(request);
    if (!identity) throw unauthorized();
    return identity.userId;
  };
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

  routes.get('/challenges/:slug/content', {
    schema: {
      operationId: 'getChallengeContent',
      tags: ['Catalog'],
      description: 'Public briefing. Hint bodies and walkthroughs are never included.',
      params: slugParams,
      response: { ...errorResponses, 200: contentSchema },
    },
  }, async (request) => {
    const found = await options.content.findContent(request.params.slug);
    if (found === null) throw notFound('Challenge not found');
    const { artifactVersion, ...content } = found;
    return {
      ...content,
      artifacts: artifactVersion === null ? [] : await options.artifacts.list(request.params.slug, artifactVersion),
    };
  });

  routes.get('/challenges/:slug/artifacts/:filename', {
    preValidation: authenticate('profile:read', true),
    schema: {
      operationId: 'downloadChallengeArtifact',
      tags: ['Catalog'],
      description: 'Requires profile:read. Returns the file as an attachment.',
      security: serviceTokenSecurity,
      params: slugParams.extend({ filename: z.string().regex(ARTIFACT_FILENAME) }),
      response: { ...errorResponses, 200: z.any().describe('The file, as application/octet-stream.') },
    },
  }, async (request, reply) => {
    const found = await options.content.findContent(request.params.slug);
    const bytes = found?.artifactVersion == null
      ? null
      : await options.artifacts.read(request.params.slug, found.artifactVersion, request.params.filename);
    if (bytes === null) throw notFound('Artifact not found');
    // Learner-facing files may be anything, so they are never rendered inline.
    return reply
      .header('Content-Type', 'application/octet-stream')
      .header('Content-Disposition', `attachment; filename="${request.params.filename}"`)
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cache-Control', 'no-store')
      .send(bytes);
  });

  routes.get('/challenges/:slug/state', {
    preValidation: authenticate('profile:read'),
    schema: {
      operationId: 'getPlayerChallengeState',
      tags: ['Catalog'],
      description: 'Requires profile:read. Returns only what this player has unlocked.',
      security: serviceTokenSecurity,
      params: slugParams,
      response: { ...errorResponses, 200: stateSchema },
    },
  }, async (request) => {
    const found = await options.content.findPlayerState(identityOf(request), request.params.slug);
    if (found === null) throw notFound('Challenge not found');
    return found;
  });

  routes.post('/challenges/:slug/hints/:position/unlock', {
    preValidation: authenticate('submissions:write'),
    schema: {
      operationId: 'unlockChallengeHint',
      tags: ['Catalog'],
      description: 'Requires submissions:write. Safe to retry; charges the hint cost once.',
      security: serviceTokenSecurity,
      params: slugParams.extend({ position: z.coerce.number().int().positive().max(100) }),
      response: { ...errorResponses, 200: stateSchema },
    },
  }, async (request) => {
    const found = await options.content.unlockHint({
      userId: identityOf(request),
      slug: request.params.slug,
      position: request.params.position,
      correlationId: request.id,
      now: new Date(),
    });
    if (found === null) throw notFound('Hint not found');
    return found;
  });

  routes.post('/challenges/:slug/walkthrough/unlock', {
    preValidation: authenticate('submissions:write'),
    schema: {
      operationId: 'unlockChallengeWalkthrough',
      tags: ['Catalog'],
      description: 'Requires submissions:write. Before a solve this forfeits the points.',
      security: serviceTokenSecurity,
      params: slugParams,
      response: { ...errorResponses, 200: stateSchema },
    },
  }, async (request) => {
    const found = await options.content.unlockWalkthrough({
      userId: identityOf(request),
      slug: request.params.slug,
      correlationId: request.id,
      now: new Date(),
    });
    if (found === null) throw notFound('Walkthrough not found');
    return found;
  });
}
