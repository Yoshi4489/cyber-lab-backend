export type ScoringResult = {
  submissionId: string;
  correct: boolean;
  pointsAwarded: number;
  firstSolve: boolean;
};

export type ScoringRepository = {
  recordSubmission: (input: {
    userId: string;
    challengeId: string;
    instanceId: string;
    correct: boolean;
    correlationId?: string;
    now: Date;
  }) => Promise<ScoringResult | null>;
};
