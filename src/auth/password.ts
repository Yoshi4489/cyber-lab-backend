import { argon2id, hash, verify } from 'argon2';

export type PasswordHashParameters = {
  memoryCost: number;
  timeCost: number;
  parallelism: number;
  hashLength: number;
};

export type PasswordHasher = {
  hash: (password: string) => Promise<string>;
  verify: (passwordHash: string, password: string) => Promise<boolean>;
};

export const PRODUCTION_PASSWORD_HASH_PARAMETERS: Readonly<PasswordHashParameters> = {
  memoryCost: 64 * 1024,
  timeCost: 3,
  parallelism: 1,
  hashLength: 32,
};

export function createPasswordHasher(
  parameters: PasswordHashParameters = PRODUCTION_PASSWORD_HASH_PARAMETERS,
): PasswordHasher {
  return {
    hash: (password) =>
      hash(password, {
        type: argon2id,
        ...parameters,
      }),
    verify: (passwordHash, password) => verify(passwordHash, password),
  };
}
