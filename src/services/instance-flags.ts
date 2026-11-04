import { createHmac, timingSafeEqual } from 'node:crypto';

export type InstanceFlagContext = {
  userId: string;
  challengeId: string;
  instanceId: string;
};

export type InstanceFlagService = {
  derive: (context: InstanceFlagContext) => string;
  verify: (context: InstanceFlagContext, submittedFlag: string) => boolean;
};

export class HmacInstanceFlagService implements InstanceFlagService {
  constructor(private readonly secret: string) {
    if (Buffer.byteLength(secret, 'utf8') < 32) {
      throw new Error('Instance flag secret must be at least 32 bytes');
    }
  }

  derive(context: InstanceFlagContext): string {
    const digest = createHmac('sha256', this.secret)
      .update('cyber-range-instance-flag-v1\0', 'utf8')
      .update(context.userId, 'utf8')
      .update('\0', 'utf8')
      .update(context.challengeId, 'utf8')
      .update('\0', 'utf8')
      .update(context.instanceId, 'utf8')
      .digest('base64url');
    return `CTF{v1_${digest}}`;
  }

  verify(context: InstanceFlagContext, submittedFlag: string): boolean {
    return flagMatches(submittedFlag, this.derive(context));
  }
}

/**
 * Download challenges have no instance, so one flag per challenge version is
 * baked into the files by the operator build. Derived, never stored.
 */
export function deriveArtifactFlag(secret: string, context: { challengeId: string; version: number }): string {
  if (Buffer.byteLength(secret, 'utf8') < 32) {
    throw new Error('Instance flag secret must be at least 32 bytes');
  }
  const digest = createHmac('sha256', secret)
    .update('cyber-range-artifact-flag-v1\0', 'utf8')
    .update(context.challengeId, 'utf8')
    .update('\0', 'utf8')
    .update(String(context.version), 'utf8')
    .digest('base64url');
  return `CTF{v1_${digest}}`;
}

/** Case-sensitive comparison that tolerates pasted surrounding whitespace. */
export function flagMatches(submittedFlag: string, expectedFlag: string): boolean {
  const actual = Buffer.from(submittedFlag.trim(), 'utf8');
  const expected = Buffer.from(expectedFlag, 'utf8');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
