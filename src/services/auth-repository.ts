export type AccountRole = 'player' | 'admin';
export type AccountStatus = 'active' | 'disabled';
export type EmailTokenPurpose = 'email_verification' | 'password_reset';

export type AccountRecord = {
  id: string;
  email: string;
  passwordHash: string;
  displayName: string;
  role: AccountRole;
  status: AccountStatus;
  emailVerifiedAt: Date | null;
};

export type SessionAccountRecord = Omit<AccountRecord, 'passwordHash'> & {
  sessionId: string;
  lastSeenAt: Date;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  revokedAt: Date | null;
};

export type SeedAccountInput = {
  email: string;
  passwordHash: string;
  displayName: string;
  role: AccountRole;
  verifiedAt: Date | null;
};

export type SeedAccountResult = {
  id: string;
  role: AccountRole;
  created: boolean;
};

export type AuthRepository = {
  findAccountByEmail: (email: string) => Promise<AccountRecord | null>;
  seedAccount: (input: SeedAccountInput) => Promise<SeedAccountResult>;
  createSession: (input: {
    userId: string;
    tokenHash: string;
    now: Date;
    idleExpiresAt: Date;
    absoluteExpiresAt: Date;
  }) => Promise<string>;
  findSessionByTokenHash: (tokenHash: string) => Promise<SessionAccountRecord | null>;
  findSessionById: (sessionId: string) => Promise<SessionAccountRecord | null>;
  touchSession: (sessionId: string, now: Date, idleExpiresAt: Date) => Promise<void>;
  revokeSessionByTokenHash: (tokenHash: string, now: Date, reason: string) => Promise<void>;
  revokeSessionsForUser: (userId: string, now: Date, reason: string) => Promise<void>;
  issueEmailToken: (input: {
    userId: string;
    purpose: EmailTokenPurpose;
    tokenHash: string;
    now: Date;
    expiresAt: Date;
  }) => Promise<void>;
  consumeVerificationToken: (tokenHash: string, now: Date) => Promise<boolean>;
  consumePasswordResetToken: (
    tokenHash: string,
    passwordHash: string,
    now: Date,
  ) => Promise<boolean>;
  appendAuditEvent: (event: {
    eventType: string;
    actorUserId?: string;
    targetUserId?: string;
    correlationId?: string;
    details?: Record<string, unknown>;
    createdAt: Date;
  }) => Promise<void>;
};
