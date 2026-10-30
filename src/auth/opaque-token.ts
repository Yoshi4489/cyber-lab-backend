import { createHash, randomBytes } from 'node:crypto';

export type OpaqueToken = {
  value: string;
  hash: string;
};

export function hashOpaqueToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function createOpaqueToken(): OpaqueToken {
  const value = randomBytes(32).toString('base64url');
  return { value, hash: hashOpaqueToken(value) };
}
