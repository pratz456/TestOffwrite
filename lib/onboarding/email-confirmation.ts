import { ActionCodeOperation, applyActionCode, checkActionCode } from 'firebase/auth';
import { auth } from '@/lib/firebase/client';

type EmailActionApi = {
  check: (code: string) => Promise<{ operation: string }>;
  apply: (code: string) => Promise<void>;
};

/** Share Strict Mode's duplicate effect, without treating a failed request as verified. */
export function createEmailConfirmation(api: EmailActionApi) {
  let latest: { code: string; promise: Promise<void> } | undefined;
  return (code: string | null, mode: string | null): Promise<void> => {
    if (!code?.trim() || mode !== 'verifyEmail') {
      return Promise.reject(new Error('Open the verification link from your email. This link cannot verify your account.'));
    }
    if (latest?.code === code) return latest.promise;
    const promise = (async () => {
      try {
        const action = await api.check(code);
        if (action.operation !== ActionCodeOperation.VERIFY_EMAIL) {
          throw Object.assign(new Error(), { code: 'writeoff/wrong-email-action' });
        }
        await api.apply(code);
      } catch (error) {
        if (latest?.code === code) latest = undefined;
        const errorCode = (error as { code?: string })?.code;
        if (errorCode === 'writeoff/wrong-email-action') {
          throw new Error('This link is not an email verification link. Open the latest verification email.');
        }
        if (errorCode === 'auth/expired-action-code' || errorCode === 'auth/invalid-action-code') {
          throw new Error('This verification link has expired or was already used. Request a new verification email, or sign in if you already verified.');
        }
        if (errorCode === 'auth/network-request-failed') {
          throw new Error('We could not verify your email. Check your connection and try again.');
        }
        throw new Error('We could not verify this email link. Request a new verification email and try again.');
      }
    })();
    latest = { code, promise };
    return promise;
  };
}

export const confirmEmailAction = createEmailConfirmation({
  check: code => checkActionCode(auth, code),
  apply: code => applyActionCode(auth, code),
});
