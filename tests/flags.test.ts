import { describe, expect, it } from 'vitest';
import { HmacInstanceFlagService } from '../src/services/instance-flags.js';

const service = new HmacInstanceFlagService('test-instance-flags-secret-at-least-thirty-two-bytes');
const context = {
  userId: '00000000-0000-4000-8000-000000000001',
  challengeId: '11111111-1111-4111-8111-111111111111',
  instanceId: '00000000-0000-4000-8000-000000000003',
};

describe('per-instance flags', () => {
  it('derives deterministically without storing a plaintext value', () => {
    const first = service.derive(context);
    expect(first).toMatch(/^CTF\{v1_[A-Za-z0-9_-]{43}\}$/u);
    expect(service.derive(context)).toBe(first);
  });

  it.each([
    ['userId', '00000000-0000-4000-8000-000000000004'],
    ['challengeId', '22222222-2222-4222-8222-222222222222'],
    ['instanceId', '00000000-0000-4000-8000-000000000005'],
  ] as const)('binds the flag to %s', (field, value) => {
    expect(service.derive({ ...context, [field]: value })).not.toBe(service.derive(context));
  });

  it('verifies in constant-time form while accepting pasted whitespace', () => {
    const flag = service.derive(context);
    expect(service.verify(context, `  ${flag}\n`)).toBe(true);
    expect(service.verify(context, 'CTF{wrong}')).toBe(false);
  });

  it('rejects weak derivation secrets', () => {
    expect(() => new HmacInstanceFlagService('too-short')).toThrow('at least 32 bytes');
  });
});
