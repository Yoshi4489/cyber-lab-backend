import { and, asc, eq, sql } from 'drizzle-orm';
import type { Database } from './client.js';
import {
  auditEvents,
  challengeHints,
  challenges,
  challengeUnlocks,
  challengeWalkthroughs,
  solves,
} from './schema.js';
import {
  hintItem,
  WALKTHROUGH_ITEM,
  type ChallengeContent,
  type ChallengeContentRepository,
  type PlayerChallengeState,
} from '../services/challenge-content.js';

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type Reader = Database | Transaction;

/** Serializes unlocks with `recordSubmission`, so a hint cannot race an award. */
export async function lockPlayerChallenge(
  transaction: Transaction,
  userId: string,
  challengeId: string,
): Promise<void> {
  await transaction.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`solve:${userId}:${challengeId}`}))`,
  );
}

export class DrizzleChallengeContentRepository implements ChallengeContentRepository {
  constructor(private readonly database: Database) {}

  async findContent(slug: string): Promise<ChallengeContent | null> {
    const [challenge] = await this.database
      .select({
        id: challenges.id,
        briefingMd: challenges.briefingMd,
        objectives: challenges.objectives,
        learningOutcomes: challenges.learningOutcomes,
        references: challenges.references,
      })
      .from(challenges)
      .where(and(eq(challenges.slug, slug), eq(challenges.published, true)))
      .limit(1);
    if (!challenge) return null;
    const { id, ...content } = challenge;
    const hints = await this.database
      .select({ position: challengeHints.position, cost: challengeHints.cost })
      .from(challengeHints)
      .where(eq(challengeHints.challengeId, id))
      .orderBy(asc(challengeHints.position));
    const [walkthrough] = await this.database
      .select({ id: challengeWalkthroughs.challengeId })
      .from(challengeWalkthroughs)
      .where(eq(challengeWalkthroughs.challengeId, id))
      .limit(1);
    return { ...content, hints, hasWalkthrough: walkthrough !== undefined };
  }

  async findPlayerState(userId: string, slug: string): Promise<PlayerChallengeState | null> {
    const challengeId = await publishedChallengeId(this.database, slug);
    return challengeId ? readState(this.database, userId, challengeId) : null;
  }

  async unlockHint(input: {
    userId: string;
    slug: string;
    position: number;
    correlationId?: string;
    now: Date;
  }): Promise<PlayerChallengeState | null> {
    return this.database.transaction(async (transaction) => {
      const challengeId = await publishedChallengeId(transaction, input.slug);
      if (!challengeId) return null;
      const [hint] = await transaction
        .select({ cost: challengeHints.cost })
        .from(challengeHints)
        .where(and(eq(challengeHints.challengeId, challengeId), eq(challengeHints.position, input.position)))
        .limit(1);
      if (!hint) return null;
      await unlock(transaction, input, challengeId, hintItem(input.position), hint.cost, 'challenge.hint_unlocked');
      return readState(transaction, input.userId, challengeId);
    });
  }

  async unlockWalkthrough(input: {
    userId: string;
    slug: string;
    correlationId?: string;
    now: Date;
  }): Promise<PlayerChallengeState | null> {
    return this.database.transaction(async (transaction) => {
      const challengeId = await publishedChallengeId(transaction, input.slug);
      if (!challengeId) return null;
      const [walkthrough] = await transaction
        .select({ id: challengeWalkthroughs.challengeId })
        .from(challengeWalkthroughs)
        .where(eq(challengeWalkthroughs.challengeId, challengeId))
        .limit(1);
      if (!walkthrough) return null;
      await unlock(transaction, input, challengeId, WALKTHROUGH_ITEM, 0, 'challenge.walkthrough_unlocked');
      return readState(transaction, input.userId, challengeId);
    });
  }
}

async function publishedChallengeId(reader: Reader, slug: string): Promise<string | null> {
  const [challenge] = await reader
    .select({ id: challenges.id })
    .from(challenges)
    .where(and(eq(challenges.slug, slug), eq(challenges.published, true)))
    .limit(1);
  return challenge?.id ?? null;
}

async function unlock(
  transaction: Transaction,
  input: { userId: string; correlationId?: string; now: Date },
  challengeId: string,
  item: string,
  cost: number,
  eventType: string,
): Promise<void> {
  await lockPlayerChallenge(transaction, input.userId, challengeId);
  const [solved] = await transaction
    .select({ id: solves.id })
    .from(solves)
    .where(and(eq(solves.userId, input.userId), eq(solves.challengeId, challengeId)))
    .limit(1);
  // After a solve nothing is at stake, so later reads are free and don't count as a forfeit.
  const costApplied = solved ? 0 : cost;
  const [inserted] = await transaction
    .insert(challengeUnlocks)
    .values({ userId: input.userId, challengeId, item, costApplied, createdAt: input.now })
    .onConflictDoNothing()
    .returning({ item: challengeUnlocks.item });
  if (!inserted) return;
  await transaction.insert(auditEvents).values({
    actorUserId: input.userId,
    eventType,
    correlationId: input.correlationId,
    details: { challengeId, item, costApplied, afterSolve: solved !== undefined },
    createdAt: input.now,
  });
}

async function readState(reader: Reader, userId: string, challengeId: string): Promise<PlayerChallengeState> {
  const [solve] = await reader
    .select({ points: solves.points, solvedAt: solves.solvedAt })
    .from(solves)
    .where(and(eq(solves.userId, userId), eq(solves.challengeId, challengeId)))
    .limit(1);
  const unlocks = await reader
    .select({
      item: challengeUnlocks.item,
      costApplied: challengeUnlocks.costApplied,
      createdAt: challengeUnlocks.createdAt,
    })
    .from(challengeUnlocks)
    .where(and(eq(challengeUnlocks.userId, userId), eq(challengeUnlocks.challengeId, challengeId)));
  const hints = await reader
    .select({ position: challengeHints.position, bodyMd: challengeHints.bodyMd })
    .from(challengeHints)
    .where(eq(challengeHints.challengeId, challengeId))
    .orderBy(asc(challengeHints.position));
  const walkthroughUnlock = unlocks.find(({ item }) => item === WALKTHROUGH_ITEM);
  const canReadWalkthrough = solve !== undefined || walkthroughUnlock !== undefined;
  const [walkthrough] = canReadWalkthrough
    ? await reader
      .select({ bodyMd: challengeWalkthroughs.bodyMd })
      .from(challengeWalkthroughs)
      .where(eq(challengeWalkthroughs.challengeId, challengeId))
      .limit(1)
    : [];
  const costs = new Map(unlocks.map(({ item, costApplied }) => [item, costApplied]));
  return {
    solved: solve !== undefined,
    pointsAwarded: solve?.points ?? null,
    costApplied: unlocks.reduce((total, { costApplied }) => total + costApplied, 0),
    // An unlock recorded after the solve never changed the award.
    forfeited: walkthroughUnlock !== undefined &&
      (solve === undefined || walkthroughUnlock.createdAt < solve.solvedAt),
    unlockedHints: hints.flatMap(({ position, bodyMd }) => {
      const costApplied = costs.get(hintItem(position));
      return costApplied === undefined ? [] : [{ position, bodyMd, costApplied }];
    }),
    walkthroughMd: walkthrough?.bodyMd ?? null,
  };
}
