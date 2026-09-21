import { sql } from 'drizzle-orm';
import type { Database } from './client.js';
import type {
  LeaderboardEntry,
  PlayerProgress,
  ProgressRepository,
  ProgressSolve,
} from '../services/progress-repository.js';

type ProfileRow = {
  userId: string;
  displayName: string;
  bio: string | null;
};

type CountRow = { count: number };

type LeaderboardRow = {
  displayName: string;
  totalPoints: number | string;
  solvedCount: number | string;
  lastSolvedAt: Date | string | null;
};

type ProgressSolveRow = Omit<ProgressSolve, 'points' | 'solvedAt'> & {
  points: number | string;
  solvedAt: Date | string;
};

export class DrizzleProgressRepository implements ProgressRepository {
  constructor(private readonly database: Database) {}

  async getPlayerProgress(userId: string): Promise<PlayerProgress | null> {
    const profileResult = await this.database.execute(sql<ProfileRow>`
      select
        users.id as "userId",
        user_profiles.display_name as "displayName",
        user_profiles.bio
      from users
      inner join user_profiles on user_profiles.user_id = users.id
      where users.id = ${userId}
        and users.status = 'active'
      limit 1
    `);
    const profile = profileResult.rows[0] as ProfileRow | undefined;
    if (!profile) return null;

    const solveResult = await this.database.execute(sql<ProgressSolve>`
      select
        challenges.id as "challengeId",
        challenges.slug,
        challenges.title,
        solves.points,
        solves.solved_at as "solvedAt"
      from solves
      inner join challenges on challenges.id = solves.challenge_id
      where solves.user_id = ${userId}
      order by solves.solved_at asc, challenges.id asc
    `);
    const availableResult = await this.database.execute(sql<CountRow>`
      select count(*)::integer as count
      from challenges
      where published = true
    `);
    const solveRows = solveResult.rows as unknown as ProgressSolveRow[];
    const solves = solveRows.map((solve) => ({
      ...solve,
      points: Number(solve.points),
      solvedAt: toDate(solve.solvedAt),
    }));
    const available = availableResult.rows[0] as CountRow | undefined;

    return {
      ...profile,
      totalPoints: solves.reduce((total, solve) => total + solve.points, 0),
      solvedCount: solves.length,
      availableChallenges: Number(available?.count ?? 0),
      solves,
    };
  }

  async listLeaderboard(limit: number): Promise<LeaderboardEntry[]> {
    const result = await this.database.execute(sql<LeaderboardRow>`
      select
        user_profiles.display_name as "displayName",
        coalesce(sum(solves.points), 0)::integer as "totalPoints",
        count(solves.id)::integer as "solvedCount",
        max(solves.solved_at) as "lastSolvedAt"
      from users
      inner join user_profiles on user_profiles.user_id = users.id
      left join solves on solves.user_id = users.id
      where users.status = 'active'
        and users.role = 'player'
      group by users.id, user_profiles.display_name
      order by
        "totalPoints" desc,
        "solvedCount" desc,
        "lastSolvedAt" asc nulls last,
        user_profiles.display_name asc,
        users.id asc
      limit ${limit}
    `);

    const entries = result.rows as unknown as LeaderboardRow[];
    return entries.map((entry, index) => ({
      rank: index + 1,
      displayName: entry.displayName,
      totalPoints: Number(entry.totalPoints),
      solvedCount: Number(entry.solvedCount),
      lastSolvedAt: entry.lastSolvedAt === null ? null : toDate(entry.lastSolvedAt),
    }));
  }
}

function toDate(value: Date | string): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('Database returned an invalid timestamp');
  return date;
}
