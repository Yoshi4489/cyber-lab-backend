import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireBff } from '../auth/require-bff.js';
import type { Config } from '../config.js';
import { forbidden } from '../lib/errors.js';
import type {
  AuthenticationService,
  ResolvedSession,
} from '../services/authentication.js';
import { bffAuthSecurity, errorResponses } from './schemas.js';

const emailSchema = z.email().max(320);
const passwordSchema = z.string().min(12).max(1024);
const opaqueTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/u);

const trustedUserSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  displayName: z.string(),
  role: z.enum(['player', 'admin']),
  emailVerified: z.boolean(),
});

const resolvedSessionSchema = z.object({
  sessionId: z.uuid(),
  user: trustedUserSchema,
  allowedScopes: z.array(z.string()),
  idleExpiresAt: z.iso.datetime(),
  absoluteExpiresAt: z.iso.datetime(),
});

const loginResponseSchema = resolvedSessionSchema.extend({
  sessionToken: opaqueTokenSchema,
});

const acceptedSchema = z.object({ accepted: z.literal(true) });

export async function registerAuthenticationRoutes(
  app: FastifyInstance,
  options: { config: Config; authentication: AuthenticationService },
) {
  const routes = app.withTypeProvider<ZodTypeProvider>();
  const rateLimit = {
    max: options.config.AUTH_RATE_LIMIT_MAX,
    timeWindow: options.config.AUTH_RATE_LIMIT_WINDOW,
  };
  const authorize = async (request: FastifyRequest): Promise<void> => {
    requireBff(request.headers.authorization, options.config);
  };

  routes.post('/auth/login', {
    config: { rateLimit },
    preValidation: authorize,
    schema: {
      operationId: 'login',
      tags: ['Authentication'],
      description: 'Verify credentials and issue a fresh opaque backend session.',
      security: bffAuthSecurity,
      body: z.object({ email: emailSchema, password: passwordSchema }).strict(),
      response: { ...errorResponses, 200: loginResponseSchema },
    },
  }, async (request) => {
    const result = await options.authentication.login(
      request.body.email,
      request.body.password,
    );
    return serializeSession(result);
  });

  routes.post('/auth/session', {
    config: { rateLimit },
    preValidation: authorize,
    schema: {
      operationId: 'resolveSession',
      tags: ['Authentication'],
      description: 'Resolve a live opaque session for the trusted frontend BFF.',
      security: bffAuthSecurity,
      body: z.object({ sessionToken: opaqueTokenSchema }).strict(),
      response: { ...errorResponses, 200: resolvedSessionSchema },
    },
  }, async (request) =>
    serializeSession(await options.authentication.resolveSession(request.body.sessionToken)));

  routes.post('/auth/logout', {
    config: { rateLimit },
    preValidation: authorize,
    schema: {
      operationId: 'logout',
      tags: ['Authentication'],
      description: 'Revoke an opaque session. Repeated logout is harmless.',
      security: bffAuthSecurity,
      body: z.object({ sessionToken: opaqueTokenSchema }).strict(),
      response: { ...errorResponses, 204: z.null() },
    },
  }, async (request, reply) => {
    await options.authentication.logout(request.body.sessionToken);
    return reply.code(204).send(null);
  });

  routes.post('/auth/verification/request', {
    config: { rateLimit },
    preValidation: authorize,
    schema: {
      operationId: 'requestEmailVerification',
      tags: ['Authentication'],
      description: 'Return a generic acknowledgement and send a verification link when eligible.',
      security: bffAuthSecurity,
      body: z.object({ email: emailSchema }).strict(),
      response: { ...errorResponses, 202: acceptedSchema },
    },
  }, async (request, reply) => {
    await options.authentication.requestEmailVerification(request.body.email);
    return reply.code(202).send({ accepted: true });
  });

  routes.post('/auth/verification/confirm', {
    config: { rateLimit },
    preValidation: authorize,
    schema: {
      operationId: 'confirmEmailVerification',
      tags: ['Authentication'],
      security: bffAuthSecurity,
      body: z.object({ token: opaqueTokenSchema }).strict(),
      response: { ...errorResponses, 204: z.null() },
    },
  }, async (request, reply) => {
    await options.authentication.confirmEmailVerification(request.body.token);
    return reply.code(204).send(null);
  });

  routes.post('/auth/password-reset/request', {
    config: { rateLimit },
    preValidation: authorize,
    schema: {
      operationId: 'requestPasswordReset',
      tags: ['Authentication'],
      description: 'Return a generic acknowledgement and send a reset link when eligible.',
      security: bffAuthSecurity,
      body: z.object({ email: emailSchema }).strict(),
      response: { ...errorResponses, 202: acceptedSchema },
    },
  }, async (request, reply) => {
    await options.authentication.requestPasswordReset(request.body.email);
    return reply.code(202).send({ accepted: true });
  });

  routes.post('/auth/password-reset/confirm', {
    config: { rateLimit },
    preValidation: authorize,
    schema: {
      operationId: 'confirmPasswordReset',
      tags: ['Authentication'],
      security: bffAuthSecurity,
      body: z.object({ token: opaqueTokenSchema, newPassword: passwordSchema }).strict(),
      response: { ...errorResponses, 204: z.null() },
    },
  }, async (request, reply) => {
    await options.authentication.confirmPasswordReset(
      request.body.token,
      request.body.newPassword,
    );
    return reply.code(204).send(null);
  });

  routes.post('/auth/signup', {
    config: { rateLimit },
    preValidation: authorize,
    schema: {
      operationId: 'signup',
      tags: ['Authentication'],
      description: 'Public signup remains closed until the security launch gate passes.',
      security: bffAuthSecurity,
      body: z.object({
        email: emailSchema,
        password: passwordSchema,
        displayName: z.string().trim().min(1).max(64),
      }).strict(),
      response: errorResponses,
    },
  }, async () => {
    throw forbidden('Public signup is closed');
  });
}

function serializeSession<T extends ResolvedSession>(session: T) {
  return {
    ...session,
    idleExpiresAt: session.idleExpiresAt.toISOString(),
    absoluteExpiresAt: session.absoluteExpiresAt.toISOString(),
  };
}
