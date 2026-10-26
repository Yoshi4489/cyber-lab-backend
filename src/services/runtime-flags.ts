import { WELCOME_CHALLENGE_ID } from '../catalog/definitions.js';
import { WELCOME_LAB_PUBLIC_FLAG, type WelcomeLabConfig } from '../welcome-lab-config.js';
import { HmacInstanceFlagService, type InstanceFlagService } from './instance-flags.js';

/** Worker injection only. Submission verification remains a separate boundary. */
export function createRuntimeFlagDeriver(
  secret: string,
  welcome: WelcomeLabConfig,
): Pick<InstanceFlagService, 'derive'> {
  const dynamicFlags = new HmacInstanceFlagService(secret);
  const welcomeFlag = welcome.WELCOME_LAB_TEST_ENABLED ? welcome.WELCOME_LAB_FLAG : undefined;
  if (welcome.WELCOME_LAB_TEST_ENABLED && welcomeFlag !== WELCOME_LAB_PUBLIC_FLAG) {
    throw new Error('Invalid Welcome runtime configuration');
  }
  return {
    derive(context) {
      if (context.challengeId === WELCOME_CHALLENGE_ID && welcomeFlag !== undefined) {
        return welcomeFlag;
      }
      return dynamicFlags.derive(context);
    },
  };
}
