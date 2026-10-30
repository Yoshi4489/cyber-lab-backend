import type { Config } from '../config.js';
import { GmailMailer } from './gmail-mailer.js';
import { LocalDevelopmentMailer } from './local-development-mailer.js';
import type { AuthMailer } from './mailer.js';
import { ResendMailer } from './resend-mailer.js';

export function createAuthMailer(config: Config): AuthMailer {
  if (config.MAIL_PROVIDER === 'resend') {
    if (!config.RESEND_API_KEY || !config.EMAIL_FROM) {
      throw new Error('Resend delivery requires RESEND_API_KEY and EMAIL_FROM');
    }
    return new ResendMailer({
      apiKey: config.RESEND_API_KEY,
      from: config.EMAIL_FROM,
      senderName: config.EMAIL_SENDER_NAME,
      frontendOrigin: config.FRONTEND_ORIGIN,
    });
  }
  if (config.MAIL_PROVIDER === 'gmail') {
    if (config.NODE_ENV === 'production' || !config.SMTP_USER || !config.SMTP_APP_PASSWORD) {
      throw new Error('Gmail demo delivery requires development credentials');
    }
    return new GmailMailer({
      user: config.SMTP_USER,
      appPassword: config.SMTP_APP_PASSWORD,
      senderName: config.EMAIL_SENDER_NAME,
      frontendOrigin: config.FRONTEND_ORIGIN,
    });
  }
  return new LocalDevelopmentMailer(config.LOCAL_MAIL_DIRECTORY, config.FRONTEND_ORIGIN, config.NODE_ENV);
}
