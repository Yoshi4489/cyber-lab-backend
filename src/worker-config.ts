import { z } from 'zod';

const workerEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.url(),
  REDIS_URL: z.url(),
  INSTANCE_FLAG_SECRET: z.string().min(32),
  RUNTIME_MANIFEST_PATH: z.string().min(1),
  TRAEFIK_DYNAMIC_DIRECTORY: z.string().min(1),
  LAB_INGRESS_CONTAINER: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/u),
  LAB_NODE_NAME: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/u).default('local-lab-node'),
  DOCKER_SOCKET_PATH: z.string().min(1).optional(),
  DOCKER_HOST: z.url().refine((value) => {
    const endpoint = new URL(value);
    return endpoint.protocol === 'https:' && !endpoint.username && !endpoint.password &&
      endpoint.pathname === '/' && !endpoint.search && !endpoint.hash;
  }, 'Docker endpoint must be an HTTPS host with no credentials, path, query, or fragment').optional(),
  DOCKER_CA_PATH: z.string().min(1).optional(),
  DOCKER_CERT_PATH: z.string().min(1).optional(),
  DOCKER_KEY_PATH: z.string().min(1).optional(),
  LIFECYCLE_DISPATCH_INTERVAL_MS: z.coerce.number().int().min(250).max(30_000).default(2_000),
  LIFECYCLE_MAINTENANCE_INTERVAL_MS: z.coerce.number().int().min(5_000).max(300_000).default(60_000),
}).superRefine((config, context) => {
  const tlsPaths = [config.DOCKER_CA_PATH, config.DOCKER_CERT_PATH, config.DOCKER_KEY_PATH];
  const completeRemote = config.DOCKER_HOST && tlsPaths.every(Boolean);
  const anyRemote = config.DOCKER_HOST || tlsPaths.some(Boolean);
  if (config.DOCKER_SOCKET_PATH && anyRemote) {
    context.addIssue({ code: 'custom', message: 'Choose a local Docker socket or remote mTLS' });
  }
  if (!config.DOCKER_SOCKET_PATH && !completeRemote) {
    context.addIssue({ code: 'custom', message: 'Remote Docker requires host, CA, cert, and key' });
  }
  if (config.NODE_ENV === 'production' && config.DOCKER_SOCKET_PATH) {
    context.addIssue({ code: 'custom', message: 'Production workers require remote Docker mTLS' });
  }
});

export type WorkerConfig = z.infer<typeof workerEnvSchema>;

export function loadWorkerConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  return workerEnvSchema.parse(env);
}
