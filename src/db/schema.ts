import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const accountRole = pgEnum('account_role', ['player', 'admin']);
export const accountStatus = pgEnum('account_status', ['active', 'disabled']);
export const emailTokenPurpose = pgEnum('email_token_purpose', [
  'email_verification',
  'password_reset',
]);
export const challengeDifficulty = pgEnum('challenge_difficulty', ['easy', 'medium', 'hard']);
export const challengeKind = pgEnum('challenge_kind', ['web', 'shell']);

export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    email: varchar('email', { length: 320 }).notNull(),
    passwordHash: text('password_hash').notNull(),
    role: accountRole('role').default('player').notNull(),
    status: accountStatus('status').default('active').notNull(),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('users_email_unique').on(table.email),
    check('users_email_normalized', sql`${table.email} = lower(${table.email})`),
  ],
);

export const userProfiles = pgTable('user_profiles', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  displayName: varchar('display_name', { length: 64 }).notNull(),
  bio: varchar('bio', { length: 500 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const challenges = pgTable(
  'challenges',
  {
    id: uuid('id').primaryKey(),
    slug: varchar('slug', { length: 64 }).notNull(),
    title: varchar('title', { length: 128 }).notNull(),
    summary: varchar('summary', { length: 500 }).notNull(),
    category: varchar('category', { length: 64 }).notNull(),
    difficulty: challengeDifficulty('difficulty').notNull(),
    points: integer('points').notNull(),
    kind: challengeKind('kind').notNull(),
    tags: jsonb('tags').$type<string[]>().default(sql`'[]'::jsonb`).notNull(),
    definitionVersion: integer('definition_version').default(1).notNull(),
    published: boolean('published').default(false).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('challenges_slug_unique').on(table.slug),
    index('challenges_published_category_idx').on(table.published, table.category),
    check('challenges_slug_normalized', sql`${table.slug} = lower(${table.slug})`),
    check('challenges_category_normalized', sql`${table.category} = lower(${table.category})`),
    check('challenges_points_positive', sql`${table.points} > 0`),
    check('challenges_definition_version_positive', sql`${table.definitionVersion} > 0`),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull(),
    idleExpiresAt: timestamp('idle_expires_at', { withTimezone: true }).notNull(),
    absoluteExpiresAt: timestamp('absolute_expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revocationReason: varchar('revocation_reason', { length: 64 }),
  },
  (table) => [
    uniqueIndex('sessions_token_hash_unique').on(table.tokenHash),
    index('sessions_user_id_idx').on(table.userId),
    index('sessions_expiry_idx').on(table.idleExpiresAt, table.absoluteExpiresAt),
    check(
      'sessions_idle_before_absolute',
      sql`${table.idleExpiresAt} <= ${table.absoluteExpiresAt}`,
    ),
  ],
);

export const emailTokens = pgTable(
  'email_tokens',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    purpose: emailTokenPurpose('purpose').notNull(),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('email_tokens_token_hash_unique').on(table.tokenHash),
    index('email_tokens_user_purpose_idx').on(table.userId, table.purpose),
    index('email_tokens_expiry_idx').on(table.expiresAt),
    check(
      'email_tokens_consumed_after_creation',
      sql`${table.consumedAt} is null or ${table.consumedAt} >= ${table.createdAt}`,
    ),
  ],
);

export const submissions = pgTable(
  'submissions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    challengeId: uuid('challenge_id')
      .notNull()
      .references(() => challenges.id, { onDelete: 'restrict' }),
    instanceId: uuid('instance_id').notNull(),
    correct: boolean('correct').notNull(),
    pointsAwarded: integer('points_awarded').default(0).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('submissions_user_challenge_created_idx').on(
      table.userId,
      table.challengeId,
      table.createdAt,
    ),
    index('submissions_instance_idx').on(table.instanceId),
    check('submissions_points_nonnegative', sql`${table.pointsAwarded} >= 0`),
    check(
      'submissions_incorrect_awards_no_points',
      sql`${table.correct} or ${table.pointsAwarded} = 0`,
    ),
  ],
);

export const solves = pgTable(
  'solves',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    challengeId: uuid('challenge_id')
      .notNull()
      .references(() => challenges.id, { onDelete: 'restrict' }),
    firstSubmissionId: uuid('first_submission_id')
      .notNull()
      .references(() => submissions.id, { onDelete: 'restrict' }),
    points: integer('points').notNull(),
    solvedAt: timestamp('solved_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('solves_user_challenge_unique').on(table.userId, table.challengeId),
    uniqueIndex('solves_first_submission_unique').on(table.firstSubmissionId),
    index('solves_user_solved_at_idx').on(table.userId, table.solvedAt),
    index('solves_leaderboard_idx').on(table.points, table.solvedAt),
    check('solves_points_positive', sql`${table.points} > 0`),
  ],
);

export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    actorUserId: uuid('actor_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    targetUserId: uuid('target_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    eventType: varchar('event_type', { length: 96 }).notNull(),
    correlationId: varchar('correlation_id', { length: 128 }),
    details: jsonb('details').default(sql`'{}'::jsonb`).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('audit_events_actor_idx').on(table.actorUserId),
    index('audit_events_target_idx').on(table.targetUserId),
    index('audit_events_created_at_idx').on(table.createdAt),
  ],
);
