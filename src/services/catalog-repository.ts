export type Difficulty = 'easy' | 'medium' | 'hard';
export type ChallengeKind = 'web' | 'shell';

export type CatalogChallenge = {
  id: string;
  slug: string;
  title: string;
  summary: string;
  category: string;
  difficulty: Difficulty;
  points: number;
  kind: ChallengeKind;
  tags: string[];
};

export type CatalogRepository = {
  listCategories: () => Promise<string[]>;
  listPublishedChallenges: () => Promise<CatalogChallenge[]>;
  findPublishedChallengeBySlug: (slug: string) => Promise<CatalogChallenge | null>;
};
