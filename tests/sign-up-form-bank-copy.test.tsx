import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/firebase/auth', () => ({ signUpUser: vi.fn(), signInWithGoogle: vi.fn(), handleAuthRedirectResult: vi.fn() }));
vi.mock('@/lib/firebase/auth-context', () => ({ useAuth: () => ({ user: null, loading: false }) }));
vi.mock('@/lib/firebase/client', () => ({ auth: { currentUser: null } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }) }));
vi.mock('next/image', () => ({ default: () => null }));
vi.mock('@/public/writeofflogo.png', () => ({ default: { src: '/writeofflogo.png', width: 1, height: 1 } }));

import { SignUpForm } from '@/components/sign-up-form';

const BANK_AUTHORIZATION = 'I authorize WriteOff to access and use my account and transaction data via Plaid';

describe('sign-up form bank copy', () => {
  it('does not render the bank-data authorization text', () => {
    const html = renderToStaticMarkup(<SignUpForm />);
    expect(html).not.toContain(BANK_AUTHORIZATION);
    expect(html).not.toContain('id="bankConsent"');
    expect(html).toContain('id="termsConsent"');
    expect(html).toContain('id="aiConsent"');
    expect(html).toContain('Create Account');
  });
});
