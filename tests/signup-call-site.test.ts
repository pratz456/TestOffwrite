import { beforeEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({
  create: vi.fn(),
  verifyEmail: vi.fn(),
  attributeSignup: vi.fn(),
}));

vi.mock('firebase/auth', () => ({
  signInWithEmailAndPassword: vi.fn(), createUserWithEmailAndPassword: sdk.create, signOut: vi.fn(),
  sendPasswordResetEmail: vi.fn(), sendEmailVerification: sdk.verifyEmail, updatePassword: vi.fn(),
  onAuthStateChanged: vi.fn(), getAuth: vi.fn(), GoogleAuthProvider: class {},
  signInWithPopup: vi.fn(), browserPopupRedirectResolver: {}, signInWithRedirect: vi.fn(), getRedirectResult: vi.fn(),
}));
vi.mock('@/lib/firebase/client', () => ({ auth: {}, app: {} }));
vi.mock('@/lib/analytics/sign-up', () => ({ attributeSignup: sdk.attributeSignup }));

import { signUpUser } from '@/lib/firebase/auth';

beforeEach(() => {
  sdk.create.mockReset();
  sdk.verifyEmail.mockReset();
  sdk.attributeSignup.mockReset();
  sdk.verifyEmail.mockResolvedValue(undefined);
  sdk.attributeSignup.mockResolvedValue(undefined);
});

describe('email account creation records the campaign source once', () => {
  it('calls attribution once after the account exists and still sends verification', async () => {
    const user = { uid: 'new-user', email: 'new@example.test', getIdToken: async () => 'token' };
    sdk.create.mockResolvedValue({ user });
    const result = await signUpUser('new@example.test', 'Sup3r-Secret!!');
    expect(result.error).toBeNull();
    expect(result.data?.user.id).toBe('new-user');
    expect(sdk.attributeSignup).toHaveBeenCalledTimes(1);
    expect(sdk.attributeSignup).toHaveBeenCalledWith('email', user);
    expect(sdk.verifyEmail).toHaveBeenCalledWith(user);
    expect(sdk.create.mock.invocationCallOrder[0]).toBeLessThan(sdk.attributeSignup.mock.invocationCallOrder[0]);
    expect(sdk.attributeSignup.mock.invocationCallOrder[0]).toBeLessThan(sdk.verifyEmail.mock.invocationCallOrder[0]);
  });

  it('still returns the new account when attribution fails', async () => {
    const user = { uid: 'new-user', email: 'new@example.test', getIdToken: async () => 'token' };
    sdk.create.mockResolvedValue({ user });
    sdk.attributeSignup.mockRejectedValue(new Error('network'));
    const result = await signUpUser('new@example.test', 'Sup3r-Secret!!');
    expect(result.error).toBeNull();
    expect(result.data?.user.id).toBe('new-user');
    expect(sdk.verifyEmail).toHaveBeenCalledOnce();
  });
});
