import { describe, expect, it, vi } from 'vitest';
import { createEmailConfirmation } from '../lib/onboarding/email-confirmation';
import { getSafeAuthRedirect } from '../lib/url';

vi.mock('@/lib/firebase/client', () => ({ auth: {} }));

function api() {
  return { check: vi.fn().mockResolvedValue({ operation: 'VERIFY_EMAIL' }), apply: vi.fn().mockResolvedValue(undefined) };
}

describe('verification email action', () => {
  it.each([[null, null], ['', 'verifyEmail'], ['   ', 'verifyEmail'], ['code', 'resetPassword'], ['code', null]])(
    'does not confirm an absent or wrong-purpose link (%s, %s)', async (code, mode) => {
      const backend = api();
      await expect(createEmailConfirmation(backend)(code, mode)).rejects.toThrow('verification link');
      expect(backend.check).not.toHaveBeenCalled();
      expect(backend.apply).not.toHaveBeenCalled();
    },
  );
  it('waits for Firebase to apply a checked verification action before succeeding', async () => {
    const backend = api();
    let finish!: () => void;
    backend.apply.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    const success = vi.fn();
    const promise = createEmailConfirmation(backend)('valid-code', 'verifyEmail').then(success);
    await vi.waitFor(() => expect(backend.apply).toHaveBeenCalledWith('valid-code'));
    expect(success).not.toHaveBeenCalled();
    finish(); await promise;
    expect(success).toHaveBeenCalledOnce();
  });
  it('does not apply a real code for a different Firebase action', async () => {
    const backend = api(); backend.check.mockResolvedValue({ operation: 'PASSWORD_RESET' });
    await expect(createEmailConfirmation(backend)('wrong-code', 'verifyEmail')).rejects.toThrow('not an email verification link');
    expect(backend.apply).not.toHaveBeenCalled();
  });
  it.each(['auth/invalid-action-code', 'auth/expired-action-code'])('does not report success for %s', async code => {
    const backend = api(); backend.apply.mockRejectedValue({ code });
    await expect(createEmailConfirmation(backend)('expired', 'verifyEmail')).rejects.toThrow('expired or was already used');
  });
  it('shares the one-time action across duplicate mount effects', async () => {
    const backend = api(); const verify = createEmailConfirmation(backend);
    const first = verify('valid', 'verifyEmail');
    expect(verify('valid', 'verifyEmail')).toBe(first);
    await first;
    await verify('valid', 'verifyEmail');
    expect(backend.check).toHaveBeenCalledOnce();
    expect(backend.apply).toHaveBeenCalledOnce();
  });
  it('allows retry after a network failure without treating that failure as success', async () => {
    const backend = api(); backend.check.mockRejectedValueOnce({ code: 'auth/network-request-failed' });
    const verify = createEmailConfirmation(backend);
    await expect(verify('valid', 'verifyEmail')).rejects.toThrow('connection');
    await expect(verify('valid', 'verifyEmail')).resolves.toBeUndefined();
    expect(backend.check).toHaveBeenCalledTimes(2);
    expect(backend.apply).toHaveBeenCalledOnce();
  });
  it('never displays an unexpected provider diagnostic from link verification', async () => {
    const backend = api(); backend.check.mockRejectedValue(new Error('private provider diagnostic'));
    await expect(createEmailConfirmation(backend)('valid', 'verifyEmail')).rejects.toThrow('Request a new verification email');
  });
  it.each(['javascript:alert(1)', '//attacker.example', '/\\attacker.example', '/\nattacker.example', 'https://attacker.example'])('rejects unsafe next %s', next => {
    expect(getSafeAuthRedirect(next)).toBe('/protected');
  });
  it('preserves an internal post-login destination', () => {
    expect(getSafeAuthRedirect('/protected?screen=receipt-upload')).toBe('/protected?screen=receipt-upload');
  });
});
