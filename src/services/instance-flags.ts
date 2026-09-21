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
    const actual = Buffer.from(submittedFlag.trim(), 'utf8');
    const expected = Buffer.from(this.derive(context), 'utf8');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }
}
