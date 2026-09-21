export type UserRateLimiter = {
  consume: (userId: string) => boolean;
};

type RateBucket = {
  startedAt: number;
  count: number;
};

export class FixedWindowUserRateLimiter implements UserRateLimiter {
  private readonly buckets = new Map<string, RateBucket>();

  constructor(
    private readonly maximum: number,
    private readonly windowMilliseconds: number,
    private readonly now: () => number = () => Date.now(),
  ) {
    if (!Number.isInteger(maximum) || maximum < 1) throw new Error('Rate limit must be positive');
    if (!Number.isInteger(windowMilliseconds) || windowMilliseconds < 1) {
      throw new Error('Rate limit window must be positive');
    }
  }

  consume(userId: string): boolean {
    const now = this.now();
    const bucket = this.buckets.get(userId);
    if (!bucket || now - bucket.startedAt >= this.windowMilliseconds) {
      this.buckets.set(userId, { startedAt: now, count: 1 });
      return true;
    }
    if (bucket.count >= this.maximum) return false;
    bucket.count += 1;
    return true;
  }
}
