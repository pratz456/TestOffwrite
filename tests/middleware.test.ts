import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from '../middleware';

function sources(response: ReturnType<typeof middleware>, directive: string) {
  const policy = response.headers.get('Content-Security-Policy') || '';
  return policy.split('; ').find(part => part.startsWith(`${directive} `))?.split(' ').slice(1) || [];
}

afterEach(() => vi.unstubAllEnvs());

describe('onboarding browser policy', () => {
  it('allows the providers required for sign-in and bank linking', () => {
    vi.stubEnv('NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN', '');
    const response = middleware(new NextRequest('https://writeoffapp.com/auth/login'));
    expect(sources(response, 'frame-src')).toEqual(expect.arrayContaining([
      "'self'", 'https://cdn.plaid.com', 'https://writeoff-23910.firebaseapp.com',
      'https://js.stripe.com', 'https://hooks.stripe.com',
    ]));
    expect(sources(response, 'script-src')).toContain('https://apis.google.com');
    expect(sources(response, 'connect-src')).toContain('https://production.plaid.com');
    expect(sources(response, 'frame-ancestors')).toEqual(["'none'"]);
    expect(sources(response, 'frame-src')).not.toContain('*');
  });

  it('uses the testing project auth domain when configured', () => {
    vi.stubEnv('NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN', 'writeoff-production-testing.firebaseapp.com');
    const response = middleware(new NextRequest('https://writeoffapp.com/auth/sign-up'));
    expect(sources(response, 'frame-src')).toContain('https://writeoff-production-testing.firebaseapp.com');
    expect(sources(response, 'frame-src')).not.toContain('https://writeoff-23910.firebaseapp.com');
  });
});
