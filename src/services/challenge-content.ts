export type ChallengeReference = { label: string; url?: string | undefined };

export type ChallengeContent = {
  briefingMd: string;
  objectives: string[];
  learningOutcomes: string[];
  references: ChallengeReference[];
  hints: Array<{ position: number; cost: number }>;
  hasWalkthrough: boolean;
  /** Set only for artifact challenges: the version whose files are served. */
  artifactVersion: number | null;
};

export type PlayerChallengeState = {
  solved: boolean;
  pointsAwarded: number | null;
  costApplied: number;
  forfeited: boolean;
  unlockedHints: Array<{ position: number; bodyMd: string; costApplied: number }>;
  walkthroughMd: string | null;
};

export type ChallengeContentRepository = {
  findContent: (slug: string) => Promise<ChallengeContent | null>;
  findPlayerState: (userId: string, slug: string) => Promise<PlayerChallengeState | null>;
  /** Null when the published challenge or hint does not exist. Safe to retry. */
  unlockHint: (input: UnlockInput & { position: number }) => Promise<PlayerChallengeState | null>;
  /** Null when the published challenge has no walkthrough. Safe to retry. */
  unlockWalkthrough: (input: UnlockInput) => Promise<PlayerChallengeState | null>;
};

type UnlockInput = {
  userId: string;
  slug: string;
  correlationId?: string;
  now: Date;
};

export const WALKTHROUGH_ITEM = 'walkthrough';
export const hintItem = (position: number): string => `hint:${position}`;

/**
 * Hints reduce the award down to a floor of 10% of base. Opening the walkthrough
 * before solving forfeits the points; the solve itself is still recorded.
 */
export function calculateAward(
  basePoints: number,
  unlocks: ReadonlyArray<{ item: string; costApplied: number }>,
): number {
  if (unlocks.some(({ item }) => item === WALKTHROUGH_ITEM)) return 0;
  const spent = unlocks.reduce((total, { costApplied }) => total + costApplied, 0);
  return Math.max(Math.ceil(basePoints * 0.1), basePoints - spent);
}
