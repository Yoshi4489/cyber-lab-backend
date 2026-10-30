import { and, asc, eq } from 'drizzle-orm';
import type { Database } from './client.js';
import { challenges } from './schema.js';
import type { CatalogChallenge, CatalogRepository } from '../services/catalog-repository.js';

const publicChallengeSelection = {
  id: challenges.id,
  slug: challenges.slug,
  title: challenges.title,
  summary: challenges.summary,
  category: challenges.category,
  difficulty: challenges.difficulty,
  points: challenges.points,
  kind: challenges.kind,
  tags: challenges.tags,
};

export class DrizzleCatalogRepository implements CatalogRepository {
  constructor(private readonly database: Database) {}

  async listCategories(): Promise<string[]> {
    const rows = await this.database
      .selectDistinct({ category: challenges.category })
      .from(challenges)
      .where(eq(challenges.published, true))
      .orderBy(asc(challenges.category));
    return rows.map((row) => row.category);
  }

  async listPublishedChallenges(): Promise<CatalogChallenge[]> {
    return this.database
      .select(publicChallengeSelection)
      .from(challenges)
      .where(eq(challenges.published, true))
      .orderBy(asc(challenges.category), asc(challenges.title), asc(challenges.id));
  }

  async findPublishedChallengeBySlug(slug: string): Promise<CatalogChallenge | null> {
    const [challenge] = await this.database
      .select(publicChallengeSelection)
      .from(challenges)
      .where(and(eq(challenges.slug, slug), eq(challenges.published, true)))
      .limit(1);
    return challenge ?? null;
  }
}
