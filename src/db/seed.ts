import 'dotenv/config';
import { z } from 'zod';
import { createPasswordHasher } from '../auth/password.js';
import type { AccountRole } from '../services/auth-repository.js';
import { DrizzleAuthRepository } from './auth-repository.js';
import { createDatabase } from './client.js';

const seedConfigSchema = z.object({
  DATABASE_URL: z.url(),
  SEED_ADMIN_EMAIL: z.email().transform((value) => value.trim().toLowerCase()),
  SEED_ADMIN_PASSWORD: z.string().min(12).max(1024),
  SEED_ADMIN_DISPLAY_NAME: z.string().trim().min(1).max(64),
  SEED_PLAYER_EMAIL: z.email().transform((value) => value.trim().toLowerCase()),
  SEED_PLAYER_PASSWORD: z.string().min(12).max(1024),
  SEED_PLAYER_DISPLAY_NAME: z.string().trim().min(1).max(64),
});

const config = seedConfigSchema.parse(process.env);
const database = createDatabase(config.DATABASE_URL);
const repository = new DrizzleAuthRepository(database.db);
const passwordHasher = createPasswordHasher();

async function seedAccount(input: {
  email: string;
  password: string;
  displayName: string;
  role: AccountRole;
}) {
  const existing = await repository.findAccountByEmail(input.email);
  if (existing) {
    if (existing.role !== input.role) throw new Error('Seed account role does not match');
    return;
  }

  const result = await repository.seedAccount({
    email: input.email,
    passwordHash: await passwordHasher.hash(input.password),
    displayName: input.displayName,
    role: input.role,
  });
  if (result.role !== input.role) throw new Error('Seed account role does not match');
}

try {
  await seedAccount({
    email: config.SEED_ADMIN_EMAIL,
    password: config.SEED_ADMIN_PASSWORD,
    displayName: config.SEED_ADMIN_DISPLAY_NAME,
    role: 'admin',
  });
  await seedAccount({
    email: config.SEED_PLAYER_EMAIL,
    password: config.SEED_PLAYER_PASSWORD,
    displayName: config.SEED_PLAYER_DISPLAY_NAME,
    role: 'player',
  });
} finally {
  await database.close();
}
