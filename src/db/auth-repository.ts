import { and, eq, gt, isNull } from 'drizzle-orm';
import type { Database } from './client.js';
import { auditEvents, emailTokens, sessions, userProfiles, users } from './schema.js';
import type {
  AccountRecord,
  AuthRepository,
  EmailTokenPurpose,
  SeedAccountInput,
  SeedAccountResult,
  SessionAccountRecord,
} from '../services/auth-repository.js';

const accountSelection = {
  id: users.id,
  email: users.email,
  passwordHash: users.passwordHash,
  displayName: userProfiles.displayName,
  role: users.role,
  status: users.status,
  emailVerifiedAt: users.emailVerifiedAt,
};

const sessionSelection = {
  sessionId: sessions.id,
  id: users.id,
  email: users.email,
  displayName: userProfiles.displayName,
  role: users.role,
  status: users.status,
  emailVerifiedAt: users.emailVerifiedAt,
  lastSeenAt: sessions.lastSeenAt,
  idleExpiresAt: sessions.idleExpiresAt,
  absoluteExpiresAt: sessions.absoluteExpiresAt,
  revokedAt: sessions.revokedAt,
};

export class DrizzleAuthRepository implements AuthRepository {
  constructor(private readonly database: Database) {}

  async findAccountByEmail(email: string): Promise<AccountRecord | null> {
    const [account] = await this.database
      .select(accountSelection)
      .from(users)
      .innerJoin(userProfiles, eq(userProfiles.userId, users.id))
      .where(eq(users.email, email))
      .limit(1);
    return account ?? null;
  }

  async seedAccount(input: SeedAccountInput): Promise<SeedAccountResult> {
    return this.database.transaction(async (transaction) => {
      const [created] = await transaction
        .insert(users)
        .values({
          email: input.email,
          passwordHash: input.passwordHash,
          role: input.role,
          emailVerifiedAt: input.verifiedAt,
        })
        .onConflictDoNothing({ target: users.email })
        .returning({ id: users.id, role: users.role });

      if (created) {
        await transaction.insert(userProfiles).values({
          userId: created.id,
          displayName: input.displayName,
        });
        return { ...created, created: true };
      }

      const [existing] = await transaction
        .select({ id: users.id, role: users.role })
        .from(users)
        .where(eq(users.email, input.email))
        .limit(1);
      if (!existing) throw new Error('Seed account conflict could not be resolved');
      return { ...existing, created: false };
    });
  }

  async createSession(input: {
    userId: string;
    tokenHash: string;
    now: Date;
    idleExpiresAt: Date;
    absoluteExpiresAt: Date;
  }): Promise<string> {
    const [session] = await this.database
      .insert(sessions)
      .values({
        userId: input.userId,
        tokenHash: input.tokenHash,
        createdAt: input.now,
        lastSeenAt: input.now,
        idleExpiresAt: input.idleExpiresAt,
        absoluteExpiresAt: input.absoluteExpiresAt,
      })
      .returning({ id: sessions.id });
    if (!session) throw new Error('Session insert returned no id');
    return session.id;
  }

  async findSessionByTokenHash(tokenHash: string): Promise<SessionAccountRecord | null> {
    const [record] = await this.sessionQuery().where(eq(sessions.tokenHash, tokenHash)).limit(1);
    return record ?? null;
  }

  async findSessionById(sessionId: string): Promise<SessionAccountRecord | null> {
    const [record] = await this.sessionQuery().where(eq(sessions.id, sessionId)).limit(1);
    return record ?? null;
  }

  async touchSession(sessionId: string, now: Date, idleExpiresAt: Date): Promise<void> {
    await this.database
      .update(sessions)
      .set({ lastSeenAt: now, idleExpiresAt })
      .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)));
  }

  async revokeSessionByTokenHash(tokenHash: string, now: Date, reason: string): Promise<void> {
    await this.database
      .update(sessions)
      .set({ revokedAt: now, revocationReason: reason })
      .where(and(eq(sessions.tokenHash, tokenHash), isNull(sessions.revokedAt)));
  }

  async revokeSessionsForUser(userId: string, now: Date, reason: string): Promise<void> {
    await this.database
      .update(sessions)
      .set({ revokedAt: now, revocationReason: reason })
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
  }

  async issueEmailToken(input: {
    userId: string;
    purpose: EmailTokenPurpose;
    tokenHash: string;
    now: Date;
    expiresAt: Date;
  }): Promise<void> {
    await this.database.transaction(async (transaction) => {
      await transaction
        .update(emailTokens)
        .set({ consumedAt: input.now })
        .where(
          and(
            eq(emailTokens.userId, input.userId),
            eq(emailTokens.purpose, input.purpose),
            isNull(emailTokens.consumedAt),
          ),
        );
      await transaction.insert(emailTokens).values({
        userId: input.userId,
        purpose: input.purpose,
        tokenHash: input.tokenHash,
        createdAt: input.now,
        expiresAt: input.expiresAt,
      });
    });
  }

  async consumeVerificationToken(tokenHash: string, now: Date): Promise<boolean> {
    return this.database.transaction(async (transaction) => {
      const [token] = await transaction
        .update(emailTokens)
        .set({ consumedAt: now })
        .where(
          and(
            eq(emailTokens.tokenHash, tokenHash),
            eq(emailTokens.purpose, 'email_verification'),
            isNull(emailTokens.consumedAt),
            gt(emailTokens.expiresAt, now),
          ),
        )
        .returning({ userId: emailTokens.userId });
      if (!token) return false;

      await transaction
        .update(users)
        .set({ emailVerifiedAt: now, updatedAt: now })
        .where(eq(users.id, token.userId));
      return true;
    });
  }

  async consumePasswordResetToken(
    tokenHash: string,
    passwordHash: string,
    now: Date,
  ): Promise<boolean> {
    return this.database.transaction(async (transaction) => {
      const [token] = await transaction
        .update(emailTokens)
        .set({ consumedAt: now })
        .where(
          and(
            eq(emailTokens.tokenHash, tokenHash),
            eq(emailTokens.purpose, 'password_reset'),
            isNull(emailTokens.consumedAt),
            gt(emailTokens.expiresAt, now),
          ),
        )
        .returning({ userId: emailTokens.userId });
      if (!token) return false;

      await transaction
        .update(users)
        .set({ passwordHash, updatedAt: now })
        .where(eq(users.id, token.userId));
      await transaction
        .update(sessions)
        .set({ revokedAt: now, revocationReason: 'password_reset' })
        .where(and(eq(sessions.userId, token.userId), isNull(sessions.revokedAt)));
      return true;
    });
  }

  async appendAuditEvent(event: {
    eventType: string;
    actorUserId?: string;
    targetUserId?: string;
    correlationId?: string;
    details?: Record<string, unknown>;
    createdAt: Date;
  }): Promise<void> {
    await this.database.insert(auditEvents).values({
      eventType: event.eventType,
      actorUserId: event.actorUserId,
      targetUserId: event.targetUserId,
      correlationId: event.correlationId,
      details: event.details ?? {},
      createdAt: event.createdAt,
    });
  }

  private sessionQuery() {
    return this.database
      .select(sessionSelection)
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .innerJoin(userProfiles, eq(userProfiles.userId, users.id));
  }
}
