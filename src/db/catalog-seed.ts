import type { Database } from './client.js';
import { challenges } from './schema.js';
import { CHALLENGE_DEFINITIONS, WELCOME_CHALLENGE_ID } from '../catalog/definitions.js';
import { loadWelcomeLabConfig, type WelcomeLabConfig } from '../welcome-lab-config.js';

export async function seedCatalog(
  database: Database,
  welcome: WelcomeLabConfig = loadWelcomeLabConfig({}),
): Promise<void> {
  await database.transaction(async (transaction) => {
    for (const definition of CHALLENGE_DEFINITIONS) {
      const published = definition.id === WELCOME_CHALLENGE_ID
        ? welcome.WELCOME_LAB_TEST_ENABLED
        : welcome.WELCOME_LAB_TEST_ENABLED ? false : definition.published;
      await transaction
        .insert(challenges)
        .values({ ...definition, published })
        .onConflictDoUpdate({
          target: challenges.id,
          set: {
            slug: definition.slug,
            title: definition.title,
            summary: definition.summary,
            category: definition.category,
            difficulty: definition.difficulty,
            points: definition.points,
            kind: definition.kind,
            tags: definition.tags,
            definitionVersion: definition.definitionVersion,
            published,
            updatedAt: new Date(),
          },
        });
    }
  });
}
