import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalDevelopmentMailer } from '../src/services/local-development-mailer.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe('local development mailer', () => {
  it('writes verification links to an explicit local directory', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cyber-range-mail-'));
    temporaryDirectories.push(directory);
    const mailer = new LocalDevelopmentMailer(
      directory,
      'http://localhost:3000',
      'development',
    );

    await mailer.sendEmailVerification({
      email: 'player@example.test',
      token: 'local-only-token',
    });

    const files = await readdir(directory);
    expect(files).toHaveLength(1);
    const body = await readFile(join(directory, files[0] ?? ''), 'utf8');
    expect(JSON.parse(body)).toEqual({
      kind: 'email-verification',
      to: 'player@example.test',
      link: 'http://localhost:3000/verify-email?token=local-only-token',
    });
  });

  it('cannot be configured as a production mailer', () => {
    expect(
      () => new LocalDevelopmentMailer('.local-mail', 'https://example.test', 'production'),
    ).toThrow('disabled in production');
  });
});
