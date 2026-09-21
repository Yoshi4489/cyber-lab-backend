import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  FRONTEND_ORIGIN: z.url(),
  BACKEND_SERVICE_TOKEN_SECRET: z.string().min(32),
  SERVICE_TOKEN_ISSUER: z.string().min(1),
  SERVICE_TOKEN_AUDIENCE: z.string().min(1),
  DATABASE_URL: z.url().optional(),
});

export type Config = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const config = envSchema.parse(env);
  if (config.BACKEND_SERVICE_TOKEN_SECRET.startsWith('replace-with-')) {
    throw new Error('Set a generated BACKEND_SERVICE_TOKEN_SECRET before starting the server');
  }
  return config;
}
