import nodemailer from 'nodemailer';
import type { AuthMail, AuthMailer } from './mailer.js';

export type GmailSettings = {
  user: string;
  appPassword: string;
  senderName: string;
  frontendOrigin: string;
};

type Message = {
  from: { name: string; address: string };
  to: { address: string; name: string };
  subject: string;
  text: string;
};

export type MailTransport = {
  sendMail: (message: Message) => Promise<{ accepted: unknown[]; rejected: unknown[] }>;
};

export function createGmailTransport(settings: GmailSettings) {
  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: settings.user, pass: settings.appPassword.replace(/\s/gu, '') },
    tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
    logger: false,
    debug: false,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
}

/** Gmail delivery for operator-configured local demos; never logs provider errors or links. */
export class GmailMailer implements AuthMailer {
  constructor(
    private readonly settings: GmailSettings,
    private readonly transport: MailTransport = createGmailTransport(settings),
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
    try {
      const result = await this.transport.sendMail({
        from: { name: this.settings.senderName, address: this.settings.user },
        to: { address: mail.email, name: '' },
        subject,
        text: `${subject} for ${this.settings.senderName}:\n\n${link.toString()}\n\nIf you did not request this, ignore this email.`,
      });
      if (result.accepted.length !== 1 || result.rejected.length !== 0) {
        throw new Error('Recipient rejected');
      }
    } catch {
      // Provider diagnostics may contain credentials, recipient addresses or email contents.
      throw new Error('Authentication email delivery failed');
    }
  }
}
