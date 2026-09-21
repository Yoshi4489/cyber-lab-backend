import { createOpaqueToken, hashOpaqueToken } from '../auth/opaque-token.js';
import type { PasswordHasher } from '../auth/password.js';
import { invalidRequest, unauthorized } from '../lib/errors.js';
import type {
  AccountRecord,
  AccountRole,
  AuthRepository,
  SessionAccountRecord,
} from './auth-repository.js';
import type { AuthMailer } from './mailer.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const SESSION_IDLE_MS = 30 * DAY_MS;
const SESSION_ABSOLUTE_MS = 90 * DAY_MS;
const VERIFICATION_TOKEN_MS = 24 * 60 * 60 * 1000;
const PASSWORD_RESET_TOKEN_MS = 60 * 60 * 1000;

export type TrustedUser = {
  id: string;
  email: string;
  displayName: string;
  role: AccountRole;
  emailVerified: boolean;
};

export type ResolvedSession = {
  sessionId: string;
  user: TrustedUser;
  allowedScopes: string[];
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
};

export class AuthenticationService {
  private constructor(
    private readonly repository: AuthRepository,
    private readonly passwordHasher: PasswordHasher,
    private readonly mailer: AuthMailer,
    private readonly dummyPasswordHash: string,
    private readonly now: () => Date,
  ) {}

  static async create(input: {
    repository: AuthRepository;
    passwordHasher: PasswordHasher;
    mailer: AuthMailer;
    now?: () => Date;
  }): Promise<AuthenticationService> {
    return new AuthenticationService(
      input.repository,
      input.passwordHasher,
      input.mailer,
      await input.passwordHasher.hash(createOpaqueToken().value),
      input.now ?? (() => new Date()),
    );
  }

  async login(email: string, password: string): Promise<ResolvedSession & { sessionToken: string }> {
    const account = await this.repository.findAccountByEmail(normalizeEmail(email));
    const passwordHash = account?.passwordHash ?? this.dummyPasswordHash;
    const passwordMatches = await this.passwordHasher.verify(passwordHash, password);

    if (!account || !passwordMatches || account.status !== 'active') {
      throw unauthorized('Invalid email or password');
    }

    const now = this.now();
    const sessionToken = createOpaqueToken();
    const idleExpiresAt = new Date(now.getTime() + SESSION_IDLE_MS);
    const absoluteExpiresAt = new Date(now.getTime() + SESSION_ABSOLUTE_MS);
    const sessionId = await this.repository.createSession({
      userId: account.id,
      tokenHash: sessionToken.hash,
      now,
      idleExpiresAt,
      absoluteExpiresAt,
    });
    await this.repository.appendAuditEvent({
      eventType: 'auth.login.succeeded',
      actorUserId: account.id,
      targetUserId: account.id,
      createdAt: now,
    });

    return {
      sessionToken: sessionToken.value,
      sessionId,
      user: toTrustedUser(account),
      allowedScopes: scopesForRole(account.role),
      idleExpiresAt,
      absoluteExpiresAt,
    };
  }

  async resolveSession(sessionToken: string): Promise<ResolvedSession> {
    const record = await this.repository.findSessionByTokenHash(hashOpaqueToken(sessionToken));
    return this.resolveLiveSession(record);
  }

  async validateServiceSession(userId: string, sessionId: string): Promise<ResolvedSession> {
    const record = await this.repository.findSessionById(sessionId);
    if (record?.id !== userId) throw unauthorized('Invalid or expired token');
    return this.resolveLiveSession(record);
  }

  async logout(sessionToken: string): Promise<void> {
    await this.repository.revokeSessionByTokenHash(
      hashOpaqueToken(sessionToken),
      this.now(),
      'logout',
    );
  }

  async requestEmailVerification(email: string): Promise<void> {
    const account = await this.repository.findAccountByEmail(normalizeEmail(email));
    if (!account || account.status !== 'active' || account.emailVerifiedAt) return;

    const now = this.now();
    const token = createOpaqueToken();
    await this.repository.issueEmailToken({
      userId: account.id,
      purpose: 'email_verification',
      tokenHash: token.hash,
      now,
      expiresAt: new Date(now.getTime() + VERIFICATION_TOKEN_MS),
    });
    await this.mailer.sendEmailVerification({ email: account.email, token: token.value });
  }

  async confirmEmailVerification(token: string): Promise<void> {
    const consumed = await this.repository.consumeVerificationToken(
      hashOpaqueToken(token),
      this.now(),
    );
    if (!consumed) throw invalidRequest('Invalid or expired verification token');
  }

  async requestPasswordReset(email: string): Promise<void> {
    const account = await this.repository.findAccountByEmail(normalizeEmail(email));
    if (!account || account.status !== 'active') return;

    const now = this.now();
    const token = createOpaqueToken();
    await this.repository.issueEmailToken({
      userId: account.id,
      purpose: 'password_reset',
      tokenHash: token.hash,
      now,
      expiresAt: new Date(now.getTime() + PASSWORD_RESET_TOKEN_MS),
    });
    await this.mailer.sendPasswordReset({ email: account.email, token: token.value });
  }

  async confirmPasswordReset(token: string, newPassword: string): Promise<void> {
    const passwordHash = await this.passwordHasher.hash(newPassword);
    const consumed = await this.repository.consumePasswordResetToken(
      hashOpaqueToken(token),
      passwordHash,
      this.now(),
    );
    if (!consumed) throw invalidRequest('Invalid or expired password reset token');
  }

  private async resolveLiveSession(
    record: SessionAccountRecord | null,
  ): Promise<ResolvedSession> {
    const now = this.now();
    if (
      !record ||
      record.revokedAt ||
      record.status !== 'active' ||
      record.idleExpiresAt <= now ||
      record.absoluteExpiresAt <= now
    ) {
      throw unauthorized('Invalid or expired session');
    }

    const idleExpiresAt = new Date(
      Math.min(now.getTime() + SESSION_IDLE_MS, record.absoluteExpiresAt.getTime()),
    );
    await this.repository.touchSession(record.sessionId, now, idleExpiresAt);

    return {
      sessionId: record.sessionId,
      user: toTrustedUser(record),
      allowedScopes: scopesForRole(record.role),
      idleExpiresAt,
      absoluteExpiresAt: record.absoluteExpiresAt,
    };
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function toTrustedUser(account: Omit<AccountRecord, 'passwordHash'>): TrustedUser {
  return {
    id: account.id,
    email: account.email,
    displayName: account.displayName,
    role: account.role,
    emailVerified: account.emailVerifiedAt !== null,
  };
}

function scopesForRole(role: AccountRole): string[] {
  const playerScopes = ['submissions:write', 'instances:read', 'instances:write'];
  return role === 'admin' ? [...playerScopes, 'admin:write'] : playerScopes;
}
