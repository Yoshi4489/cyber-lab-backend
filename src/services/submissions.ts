import { notFound } from '../lib/errors.js';
import type { InstanceFlagService } from './instance-flags.js';
import type { ScoringRepository } from './scoring-repository.js';

export type OwnedInstanceResolver = {
  findOwnedInstance: (
    userId: string,
    instanceId: string,
  ) => Promise<{ challengeId: string } | null>;
};

export type SubmitFlagResult = {
  correct: boolean;
  points: number;
  recorded: true;
  source: 'database';
};

export class SubmissionService {
  constructor(
    private readonly repository: ScoringRepository,
    private readonly instances: OwnedInstanceResolver,
    private readonly flags: InstanceFlagService,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async submit(input: {
    userId: string;
    challengeId: string;
    instanceId: string;
    flag: string;
    correlationId?: string;
  }): Promise<SubmitFlagResult> {
    const instance = await this.instances.findOwnedInstance(input.userId, input.instanceId);
    if (!instance || instance.challengeId !== input.challengeId) {
      throw notFound('Challenge instance not found');
    }

    const correct = this.flags.verify(
      {
        userId: input.userId,
        challengeId: input.challengeId,
        instanceId: input.instanceId,
      },
      input.flag,
    );
    const result = await this.repository.recordSubmission({
      userId: input.userId,
      challengeId: input.challengeId,
      instanceId: input.instanceId,
      correct,
      ...(input.correlationId ? { correlationId: input.correlationId } : {}),
      now: this.clock(),
    });
    if (!result) throw notFound('Challenge not found');

    return {
      correct: result.correct,
      points: result.pointsAwarded,
      recorded: true,
      source: 'database',
    };
  }
}
