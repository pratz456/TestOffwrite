import { confirmPasswordReset, verifyPasswordResetCode } from 'firebase/auth';
import { auth } from '@/lib/firebase/client';
import { validatePassword } from '@/lib/utils/passwordValidation';

export class PasswordResetError extends Error {
  constructor(message: string, readonly retryable = false) {
    super(message);
    this.name = 'PasswordResetError';
  }
}

export function passwordResetError(error: unknown): PasswordResetError {
  if (error instanceof PasswordResetError) return error;
  const code = (error as { code?: string } | null)?.code;
  if (code === 'auth/invalid-action-code' || code === 'auth/expired-action-code') {
    return new PasswordResetError('This reset link has expired or was already used. Request a new password reset email.');
  }
  if (code === 'auth/network-request-failed' || code === 'auth/internal-error') {
    return new PasswordResetError('We could not reach the sign-in service. Check your connection and try again.', true);
  }
  if (code === 'auth/too-many-requests') {
    return new PasswordResetError('Too many attempts. Please wait a few minutes and try again.', true);
  }
  if (code === 'auth/weak-password' || code === 'auth/password-does-not-meet-requirements') {
    return new PasswordResetError('This password does not meet the account password requirements. Choose a stronger password.', true);
  }
  return new PasswordResetError('We could not use this reset link. Request a new password reset email.');
}

type PasswordResetApi = {
  verify: (code: string) => Promise<string>;
  confirm: (code: string, password: string) => Promise<void>;
};

/** The email action code identifies the account; a signed-in user is never a reset target. */
export function createPasswordResetActions(api: PasswordResetApi) {
  const requireCode = (code: string | null, mode: string | null): string => {
    if (!code?.trim() || mode !== 'resetPassword') {
      throw new PasswordResetError('Open the password reset link from your email, or request a new link below.');
    }
    return code;
  };
  return {
    async verify(code: string | null, mode: string | null): Promise<string> {
      try { return await api.verify(requireCode(code, mode)); }
      catch (error) { throw passwordResetError(error); }
    },
    async confirm(code: string | null, mode: string | null, password: string): Promise<void> {
      try {
        const validCode = requireCode(code, mode);
        if (!validatePassword(password).isValid) {
          throw new PasswordResetError('Please meet all the password requirements below.', true);
        }
        await api.confirm(validCode, password);
      } catch (error) { throw passwordResetError(error); }
    },
  };
}

export const passwordResetActions = createPasswordResetActions({
  verify: code => verifyPasswordResetCode(auth, code),
  confirm: (code, password) => confirmPasswordReset(auth, code, password),
});
