import { and, eq } from 'drizzle-orm';
import type { Database } from './client.js';
import { auditEvents, challenges, solves, submissions } from './schema.js';
import type { ScoringRepository, ScoringResult } from '../services/scoring-repository.js';

export class DrizzleScoringRepository implements ScoringRepository {
  constructor(private readonly database: Database) {}

  async recordSubmission(input: {
    userId: string;
    challengeId: string;
    instanceId: string;
    correct: boolean;
    correlationId?: string;
    now: Date;
  }): Promise<ScoringResult | null> {
    return this.database.transaction(async (transaction) => {
      const [challenge] = await transaction
        .select({ points: challenges.points })
        .from(challenges)
        .where(and(eq(challenges.id, input.challengeId), eq(challenges.published, true)))
        .limit(1);
      if (!challenge) return null;

      const [submission] = await transaction
        .insert(submissions)
        .values({
          userId: input.userId,
          challengeId: input.challengeId,
          instanceId: input.instanceId,
          correct: input.correct,
          createdAt: input.now,
        })
        .returning({ id: submissions.id });
      if (!submission) throw new Error('Submission insert returned no id');

      let pointsAwarded = 0;
      let firstSolve = false;
      if (input.correct) {
        const [solve] = await transaction
          .insert(solves)
          .values({
            userId: input.userId,
            challengeId: input.challengeId,
            firstSubmissionId: submission.id,
            points: challenge.points,
            solvedAt: input.now,
          })
          .onConflictDoNothing({ target: [solves.userId, solves.challengeId] })
          .returning({ id: solves.id });
        firstSolve = solve !== undefined;
        if (firstSolve) {
          pointsAwarded = challenge.points;
          await transaction
            .update(submissions)
            .set({ pointsAwarded })
            .where(eq(submissions.id, submission.id));
        }
      }

      await transaction.insert(auditEvents).values({
        actorUserId: input.userId,
        eventType: input.correct ? 'submission.correct' : 'submission.incorrect',
        correlationId: input.correlationId,
        details: {
          challengeId: input.challengeId,
          instanceId: input.instanceId,
          firstSolve,
          pointsAwarded,
        },
        createdAt: input.now,
      });

      return {
        submissionId: submission.id,
        correct: input.correct,
        pointsAwarded,
        firstSolve,
      };
    });
  }
}
