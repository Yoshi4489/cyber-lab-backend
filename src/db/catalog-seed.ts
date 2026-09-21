import type { Database } from './client.js';
import { challenges } from './schema.js';
import { CHALLENGE_DEFINITIONS } from '../catalog/definitions.js';

export async function seedCatalog(database: Database): Promise<void> {
  await database.transaction(async (transaction) => {
    for (const definition of CHALLENGE_DEFINITIONS) {
      await transaction
        .insert(challenges)
        .values(definition)
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
            published: definition.published,
            updatedAt: new Date(),
          },
        });
    }
  });
}
