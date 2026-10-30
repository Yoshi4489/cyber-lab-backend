export type ProgressSolve = {
  challengeId: string;
  slug: string;
  title: string;
  points: number;
  solvedAt: Date;
};

export type PlayerProgress = {
  userId: string;
  displayName: string;
  bio: string | null;
  totalPoints: number;
  solvedCount: number;
  availableChallenges: number;
  solves: ProgressSolve[];
};

export type LeaderboardEntry = {
  rank: number;
  displayName: string;
  totalPoints: number;
  solvedCount: number;
  lastSolvedAt: Date | null;
};

export type ProgressRepository = {
  getPlayerProgress: (userId: string) => Promise<PlayerProgress | null>;
  listLeaderboard: (limit: number) => Promise<LeaderboardEntry[]>;
};
