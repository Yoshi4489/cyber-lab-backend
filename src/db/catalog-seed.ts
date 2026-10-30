import { eq, notInArray, and } from 'drizzle-orm';
import type { Database } from './client.js';
import { challengeHints, challenges, challengeWalkthroughs } from './schema.js';
import { CHALLENGE_DEFINITIONS, WELCOME_CHALLENGE_ID } from '../catalog/definitions.js';
import { loadChallengePackages, type ChallengePackage } from '../catalog/packages.js';
import { loadWelcomeLabConfig, type WelcomeLabConfig } from '../welcome-lab-config.js';

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export async function seedCatalog(
  database: Database,
  welcome: WelcomeLabConfig = loadWelcomeLabConfig({}),
  options: { publishLabs?: boolean; packages?: readonly ChallengePackage[] } = {},
): Promise<void> {
  const publishLabs = options.publishLabs ?? false;
  const packages = options.packages ?? await loadChallengePackages();
  await database.transaction(async (transaction) => {
    for (const definition of CHALLENGE_DEFINITIONS) {
      // Samples have no target, so they are never advertised beside real labs.
      const hideSamples = welcome.WELCOME_LAB_TEST_ENABLED || publishLabs;
      const published = definition.id === WELCOME_CHALLENGE_ID
        ? welcome.WELCOME_LAB_TEST_ENABLED
        : hideSamples ? false : definition.published;
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
    for (const lab of packages) await seedPackage(transaction, lab, publishLabs && lab.published);
  });
}

async function seedPackage(transaction: Transaction, lab: ChallengePackage, published: boolean): Promise<void> {
  const content = {
    slug: lab.slug,
    title: lab.title,
    summary: lab.summary,
    category: lab.category,
    difficulty: lab.difficulty,
    points: lab.points,
    kind: lab.kind,
    tags: lab.tags,
    definitionVersion: lab.definitionVersion,
    published,
    briefingMd: lab.briefingMd,
    objectives: lab.objectives,
    learningOutcomes: lab.learningOutcomes,
    references: lab.references,
  };
  await transaction
    .insert(challenges)
    .values({ id: lab.id, ...content })
    .onConflictDoUpdate({ target: challenges.id, set: { ...content, updatedAt: new Date() } });
  await transaction
    .insert(challengeWalkthroughs)
    .values({ challengeId: lab.id, bodyMd: lab.walkthroughMd })
    .onConflictDoUpdate({ target: challengeWalkthroughs.challengeId, set: { bodyMd: lab.walkthroughMd } });
  const positions = lab.hints.map((_, index) => index + 1);
  await transaction.delete(challengeHints).where(and(
    eq(challengeHints.challengeId, lab.id),
    notInArray(challengeHints.position, positions),
  ));
  for (const [index, hint] of lab.hints.entries()) {
    await transaction
      .insert(challengeHints)
      .values({ challengeId: lab.id, position: index + 1, ...hint })
      .onConflictDoUpdate({
        target: [challengeHints.challengeId, challengeHints.position],
        set: hint,
      });
  }
}
