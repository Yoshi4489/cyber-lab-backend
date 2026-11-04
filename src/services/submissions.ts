import { notFound } from '../lib/errors.js';
import { deriveArtifactFlag, flagMatches, type InstanceFlagService } from './instance-flags.js';
import type { ScoringRepository } from './scoring-repository.js';

export type OwnedInstanceResolver = {
  findOwnedInstance: (
    userId: string,
    instanceId: string,
  ) => Promise<{ challengeId: string } | null>;
};

export type ArtifactSubmissionPolicy = {
  findArtifactChallenge: (challengeId: string) => Promise<{ definitionVersion: number } | null>;
  flagSecret: string;
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
    private readonly artifacts?: ArtifactSubmissionPolicy,
  ) {}

  async submit(input: {
    userId: string;
    challengeId: string;
    instanceId?: string | undefined;
    flag: string;
    correlationId?: string;
  }): Promise<SubmitFlagResult> {
    const correct = input.instanceId === undefined
      ? await this.verifyArtifactFlag(input.challengeId, input.flag)
      : await this.verifyInstanceFlag(input.userId, input.challengeId, input.instanceId, input.flag);
    const result = await this.repository.recordSubmission({
      userId: input.userId,
      challengeId: input.challengeId,
      instanceId: input.instanceId ?? null,
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

  private async verifyInstanceFlag(userId: string, challengeId: string, instanceId: string, flag: string): Promise<boolean> {
    const instance = await this.instances.findOwnedInstance(userId, instanceId);
    if (!instance || instance.challengeId !== challengeId) {
      throw notFound('Challenge instance not found');
    }
    return this.flags.verify({ userId, challengeId, instanceId }, flag);
  }

  /** Without an instance, only a published artifact challenge can accept a flag. */
  private async verifyArtifactFlag(challengeId: string, flag: string): Promise<boolean> {
    const challenge = await this.artifacts?.findArtifactChallenge(challengeId);
    if (!this.artifacts || !challenge) throw notFound('Challenge instance not found');
    return flagMatches(flag, deriveArtifactFlag(this.artifacts.flagSecret, {
      challengeId,
      version: challenge.definitionVersion,
    }));
  }
}
