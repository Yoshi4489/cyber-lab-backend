import { describe, expect, it, vi } from 'vitest';
import nodemailer from 'nodemailer';
import { createGmailTransport, GmailMailer } from '../src/services/gmail-mailer.js';

const settings = {
  user: 'sender@example.test',
  appPassword: 'test-only-password',
  senderName: 'Cyber Range',
  frontendOrigin: 'http://localhost:3000',
};

describe('Gmail authentication mailer', () => {
  it('requires verified TLS, bounded connections, no protocol logging and no external content access', () => {
    const spy = vi.spyOn(nodemailer, 'createTransport');
    try {
      createGmailTransport(settings);
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({
        host: 'smtp.gmail.com', port: 465, secure: true,
        tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
        connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000,
        logger: false, debug: false, disableFileAccess: true, disableUrlAccess: true,
      }));
    } finally {
      spy.mockRestore();
    }
  });
  it.each([
    ['sendEmailVerification', '/verify-email', 'Verify your email'],
    ['sendPasswordReset', '/reset-password', 'Reset your password'],
  ] as const)('delivers %s with the configured origin and an encoded token', async (method, path, subject) => {
    const sendMail = vi.fn().mockResolvedValue({ accepted: ['player@example.test'], rejected: [] });
    const mailer = new GmailMailer(settings, { sendMail });
    await mailer[method]({ email: 'player@example.test', token: 'a&b=c' });
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
      from: { name: 'Cyber Range', address: settings.user },
      to: { address: 'player@example.test', name: '' },
      subject,
      text: expect.stringContaining(`http://localhost:3000${path}?token=a%26b%3Dc`),
    }));
  });

  it('discards sensitive provider diagnostics and error causes', async () => {
    const sendMail = vi.fn().mockRejectedValue(new Error('password=secret token=secret recipient=private'));
    const mailer = new GmailMailer(settings, { sendMail });
    const error = await mailer.sendPasswordReset({ email: 'player@example.test', token: 'secret' }).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('Authentication email delivery failed');
    expect((error as Error).cause).toBeUndefined();
  });

  it('rejects an unaccepted recipient', async () => {
    const mailer = new GmailMailer(settings, {
      sendMail: vi.fn().mockResolvedValue({ accepted: [], rejected: ['player@example.test'] }),
    });
    await expect(mailer.sendEmailVerification({ email: 'player@example.test', token: 'secret' }))
      .rejects.toThrow('Authentication email delivery failed');
  });
});
