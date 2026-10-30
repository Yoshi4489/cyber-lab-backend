import { describe, expect, it, vi } from 'vitest';
import { ResendMailer } from '../src/services/resend-mailer.js';

const settings = {
  apiKey: 'test-only-provider-key', from: 'noreply@example.test',
  senderName: 'Cyber "Range"', frontendOrigin: 'https://learn.example.test',
};
const mail = { email: 'player@example.test', token: 'test&token=value' };

describe('Resend authentication mailer', () => {
  it.each([
    ['sendEmailVerification', '/verify-email', 'Verify your email'],
    ['sendPasswordReset', '/reset-password', 'Reset your password'],
  ] as const)('delivers %s over the fixed authenticated HTTPS boundary', async (method, path, subject) => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ id: 'accepted-message-id' }));
    await new ResendMailer(settings, request)[method](mail);
    const [url, options] = request.mock.calls[0]!;
    expect(url).toBe('https://api.resend.com/emails');
    expect(options).toMatchObject({ method: 'POST', redirect: 'error', signal: expect.any(AbortSignal) });
    expect(options?.headers).toMatchObject({ authorization: `Bearer ${settings.apiKey}` });
    expect(JSON.parse(options?.body as string)).toEqual({
      from: '"Cyber \\"Range\\"" <noreply@example.test>',
      to: [mail.email], subject,
      text: expect.stringContaining(`https://learn.example.test${path}?token=test%26token%3Dvalue`),
    });
  });

  it('keeps retry keys stable for the same message and distinct for different tokens and purposes', async () => {
    const request = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ id: 'accepted' }));
    const mailer = new ResendMailer(settings, request);
    await mailer.sendEmailVerification(mail);
    await mailer.sendEmailVerification(mail);
    await mailer.sendEmailVerification({ ...mail, token: 'other-token' });
    await mailer.sendPasswordReset(mail);
    const keys = request.mock.calls.map(([, options]) => new Headers(options?.headers).get('idempotency-key'));
    expect(keys[0]).toMatch(/^auth-[a-f0-9]{64}$/u);
    expect(keys[0]).toBe(keys[1]);
    expect(new Set(keys)).toHaveProperty('size', 3);
  });

  it.each([401, 429, 500])('sanitizes provider HTTP %s without reading sensitive diagnostics', async (status) => {
    const response = new Response('api-key=private token=private', { status });
    const read = vi.spyOn(response, 'json');
    const request = vi.fn<typeof fetch>().mockResolvedValue(response);
    await expect(new ResendMailer(settings, request).sendPasswordReset(mail))
      .rejects.toThrow('Authentication email delivery failed');
    expect(read).not.toHaveBeenCalled();
  });

  it('sanitizes network/timeout errors without retaining their cause', async () => {
    const request = vi.fn<typeof fetch>().mockRejectedValue(new Error('Bearer private-key token=private'));
    const error = await new ResendMailer(settings, request).sendEmailVerification(mail).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('Authentication email delivery failed');
    expect((error as Error).cause).toBeUndefined();
  });

  it('does not accept malformed success responses', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: 'private-diagnostics' }));
    await expect(new ResendMailer(settings, request).sendPasswordReset(mail))
      .rejects.toThrow('Authentication email delivery failed');
  });
});
