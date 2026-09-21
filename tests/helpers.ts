import { SignJWT } from 'jose';
import type { Config } from '../src/config.js';
import { CHALLENGE_DEFINITIONS } from '../src/catalog/definitions.js';

/** A complete, valid config so tests never depend on a `.env` file. */
export const testConfig: Config = {
  NODE_ENV: 'test',
  HOST: '127.0.0.1',
  PORT: 4000,
  FRONTEND_ORIGIN: 'http://localhost:3000',
  BFF_AUTH_SECRET: 'test-bff-secret-at-least-thirty-two-characters',
  BACKEND_SERVICE_TOKEN_SECRET: 'test-secret-at-least-thirty-two-characters',
  INSTANCE_FLAG_SECRET: 'test-instance-flag-secret-at-least-thirty-two-characters',
  SERVICE_TOKEN_ISSUER: 'cyber-range-frontend',
  SERVICE_TOKEN_AUDIENCE: 'cyber-range-backend',
  SIGNUPS_OPEN: false,
  AUTH_RATE_LIMIT_MAX: 10,
  AUTH_RATE_LIMIT_WINDOW: '1 minute',
  SUBMISSION_RATE_LIMIT_MAX: 20,
  SUBMISSION_RATE_LIMIT_WINDOW_MS: 60_000,
  LOCAL_MAIL_DIRECTORY: '.local-mail',
};

export const TEST_SESSION_ID = '00000000-0000-4000-8000-000000000002';

export const testAppDependencies = {
  catalog: {
    listCategories: async () => [
      ...new Set(CHALLENGE_DEFINITIONS.filter((challenge) => challenge.published).map((challenge) => challenge.category)),
    ].sort(),
    listPublishedChallenges: async () =>
      CHALLENGE_DEFINITIONS.filter((challenge) => challenge.published).map(toCatalogChallenge),
    findPublishedChallengeBySlug: async (slug: string) => {
      const challenge = CHALLENGE_DEFINITIONS.find(
        (candidate) => candidate.published && candidate.slug === slug,
      );
      return challenge ? toCatalogChallenge(challenge) : null;
    },
  },
  sessionAuthorizer: {
    validateServiceSession: async (userId: string, sessionId: string) => {
      if (userId !== 'player-1' || sessionId !== TEST_SESSION_ID) {
        throw new Error('Unknown test session');
      }
      return {
        allowedScopes: [
          'submissions:write',
          'instances:read',
          'instances:write',
          'admin:write',
        ],
      };
    },
  },
};

function toCatalogChallenge(challenge: (typeof CHALLENGE_DEFINITIONS)[number]) {
  const { definitionVersion: _definitionVersion, published: _published, ...publicChallenge } =
    challenge;
  return publicChallenge;
}

export function signToken(
  scope: string,
  options: { subject?: string; sessionId?: string } = {},
): Promise<string> {
  return new SignJWT({ scope, sid: options.sessionId ?? TEST_SESSION_ID })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(options.subject ?? 'player-1')
    .setIssuer(testConfig.SERVICE_TOKEN_ISSUER)
    .setAudience(testConfig.SERVICE_TOKEN_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode(testConfig.BACKEND_SERVICE_TOKEN_SECRET));
}

export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
