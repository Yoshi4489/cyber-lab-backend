import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { AuthMail, AuthMailer } from './mailer.js';

export class LocalDevelopmentMailer implements AuthMailer {
  private readonly directory: string;

  constructor(
    directory: string,
    private readonly frontendOrigin: string,
    nodeEnv: 'development' | 'test' | 'production',
  ) {
    if (nodeEnv === 'production') {
      throw new Error('Local development mail delivery is disabled in production');
    }
    this.directory = resolve(directory);
  }

  sendEmailVerification(mail: AuthMail): Promise<void> {
    return this.writeMail('email-verification', '/verify-email', mail);
  }

  sendPasswordReset(mail: AuthMail): Promise<void> {
    return this.writeMail('password-reset', '/reset-password', mail);
  }

  private async writeMail(kind: string, path: string, mail: AuthMail): Promise<void> {
    const link = new URL(path, this.frontendOrigin);
    link.searchParams.set('token', mail.token);

    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await writeFile(
      resolve(this.directory, `${kind}-${randomUUID()}.json`),
      `${JSON.stringify({ kind, to: mail.email, link: link.toString() }, null, 2)}\n`,
      { encoding: 'utf8', flag: 'wx', mode: 0o600 },
    );
  }
}
