import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { AuthMail, AuthMailer } from './mailer.js';

export type ResendSettings = {
  apiKey: string;
  from: string;
  senderName: string;
  frontendOrigin: string;
};

const acceptedResponse = z.object({ id: z.string().min(1) });

/** Fixed provider endpoint; secrets and provider diagnostics never enter logs. */
export class ResendMailer implements AuthMailer {
  constructor(
    private readonly settings: ResendSettings,
    private readonly request: typeof fetch = fetch,
  ) {}

  sendEmailVerification(mail: AuthMail): Promise<void> {
    return this.send('Verify your email', '/verify-email', mail);
  }

  sendPasswordReset(mail: AuthMail): Promise<void> {
    return this.send('Reset your password', '/reset-password', mail);
  }

  private async send(subject: string, path: string, mail: AuthMail): Promise<void> {
    const link = new URL(path, this.settings.frontendOrigin);
    link.searchParams.set('token', mail.token);
    const idempotencyKey = createHash('sha256')
      .update(JSON.stringify([path, mail.email, mail.token]))
      .digest('hex');
    try {
      const response = await this.request('https://api.resend.com/emails', {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
        headers: {
          authorization: `Bearer ${this.settings.apiKey}`,
          'content-type': 'application/json',
          'idempotency-key': `auth-${idempotencyKey}`,
        },
        body: JSON.stringify({
          from: `${JSON.stringify(this.settings.senderName)} <${this.settings.from}>`,
          to: [mail.email],
          subject,
          text: `${subject} for ${this.settings.senderName}:\n\n${link.toString()}\n\nIf you did not request this, ignore this email.`,
        }),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error('Provider rejected email');
      }
      acceptedResponse.parse(await response.json());
    } catch {
      throw new Error('Authentication email delivery failed');
    }
  }
}
