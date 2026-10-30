import { z } from 'zod';

// This is intentional public onboarding content, never an authorization secret.
export const WELCOME_LAB_PUBLIC_FLAG = 'FLAG{WELCOME_TO_CISCO_FAMILY}';

const welcomeLabEnvironment = z.object({
  WELCOME_LAB_TEST_ENABLED: z.enum(['false', 'true']).default('false')
    .transform((value) => value === 'true'),
  WELCOME_LAB_FLAG: z.literal(WELCOME_LAB_PUBLIC_FLAG).optional(),
}).superRefine((config, context) => {
  if (config.WELCOME_LAB_TEST_ENABLED && config.WELCOME_LAB_FLAG === undefined) {
    context.addIssue({
      code: 'custom',
      path: ['WELCOME_LAB_FLAG'],
      message: 'Welcome lab testing requires the approved public placeholder',
    });
  }
});

export type WelcomeLabConfig = z.infer<typeof welcomeLabEnvironment>;

/** Shared by API, worker, and explicit seed commands; never reads browser input. */
export function loadWelcomeLabConfig(env: NodeJS.ProcessEnv = process.env): WelcomeLabConfig {
  const environment = z.enum(['development', 'test', 'production']).default('development').parse(env.NODE_ENV);
  if (environment === 'production' &&
    (env.WELCOME_LAB_TEST_ENABLED !== undefined || env.WELCOME_LAB_FLAG !== undefined)) {
    throw new Error('Welcome lab test settings are disabled in production');
  }
  return welcomeLabEnvironment.parse(env);
}
