import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPasswordResetActions, passwordResetActions, passwordResetError } from '@/lib/onboarding/password-reset';

const sdk = vi.hoisted(() => ({ verify: vi.fn(), confirm: vi.fn(), update: vi.fn(), auth: { currentUser: { uid: 'different-signed-in-user' } } }));
vi.mock('firebase/auth', () => ({ verifyPasswordResetCode: sdk.verify, confirmPasswordReset: sdk.confirm, updatePassword: sdk.update }));
vi.mock('@/lib/firebase/client', () => ({ auth: sdk.auth }));

beforeEach(() => { vi.clearAllMocks(); sdk.verify.mockResolvedValue('reset-owner@example.test'); sdk.confirm.mockResolvedValue(undefined); });

describe('password reset codes identify the account independently of currentUser', () => {
  it('uses the verified code and confirmPasswordReset, never the signed-in account password API', async () => {
    expect(await passwordResetActions.verify('one-time-code', 'resetPassword')).toBe('reset-owner@example.test');
    await passwordResetActions.confirm('one-time-code', 'resetPassword', 'NewPassword!123');
    expect(sdk.verify).toHaveBeenCalledWith(sdk.auth, 'one-time-code');
    expect(sdk.confirm).toHaveBeenCalledWith(sdk.auth, 'one-time-code', 'NewPassword!123');
    expect(sdk.update).not.toHaveBeenCalled();
  });
  it.each([[null, 'resetPassword'], ['', 'resetPassword'], [' ', 'resetPassword'], ['code', null], ['code', 'verifyEmail'], ['code', 'recoverEmail']])('rejects missing or wrong-purpose links (%s, %s)', async (code, mode) => {
    await expect(passwordResetActions.verify(code, mode)).rejects.toThrow('reset link');
    await expect(passwordResetActions.confirm(code, mode, 'NewPassword!123')).rejects.toThrow('reset link');
    expect(sdk.verify).not.toHaveBeenCalled(); expect(sdk.confirm).not.toHaveBeenCalled();
  });
  it('does not send a password that violates the app requirements', async () => {
    await expect(passwordResetActions.confirm('code', 'resetPassword', 'short')).rejects.toThrow('requirements');
    expect(sdk.confirm).not.toHaveBeenCalled();
  });
  it.each(['auth/expired-action-code', 'auth/invalid-action-code'])('handles %s at validation and submission without leaking raw details', async code => {
    sdk.verify.mockRejectedValue({ code, message: 'private diagnostic' });
    sdk.confirm.mockRejectedValue({ code, message: 'private diagnostic' });
    await expect(passwordResetActions.verify('code', 'resetPassword')).rejects.toThrow('expired or was already used');
    await expect(passwordResetActions.confirm('code', 'resetPassword', 'NewPassword!123')).rejects.toMatchObject({ retryable: false });
  });
  it('permits retry after network validation failure', async () => {
    sdk.verify.mockRejectedValueOnce({ code: 'auth/network-request-failed' });
    await expect(passwordResetActions.verify('code', 'resetPassword')).rejects.toMatchObject({ retryable: true });
    await expect(passwordResetActions.verify('code', 'resetPassword')).resolves.toBe('reset-owner@example.test');
  });
  it('does not report success before Firebase commits the password change', async () => {
    let finish!: () => void;
    const api = { verify: vi.fn(), confirm: vi.fn(() => new Promise<void>(resolve => { finish = resolve; })) };
    const success = vi.fn();
    const pending = createPasswordResetActions(api).confirm('code', 'resetPassword', 'NewPassword!123').then(success);
    expect(success).not.toHaveBeenCalled(); finish(); await pending; expect(success).toHaveBeenCalledOnce();
  });
  it.each([new Error('private SDK payload'), { code: 'unknown-private-code', message: 'secret' }, null])('hides unknown error details', error => {
    expect(passwordResetError(error).message).toBe('We could not use this reset link. Request a new password reset email.');
  });
});
