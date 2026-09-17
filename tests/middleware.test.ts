import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { NextRequest } from 'next/server';
import { middleware } from '../middleware';
import { analyticsAllowedOnPath, gaMeasurementId, GOOGLE_TAG_CSP_SOURCES } from '../lib/analytics/ga-measurement-id';

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

describe('Google tag origins follow the analytics configuration', () => {
  const googleOrigins = [...new Set(Object.values(GOOGLE_TAG_CSP_SOURCES).flat())];
  const directives = ['script-src', 'img-src', 'connect-src'] as const;

  it('omits every Google tag origin when NEXT_PUBLIC_GA_MEASUREMENT_ID is unset', () => {
    vi.stubEnv('NEXT_PUBLIC_GA_MEASUREMENT_ID', '');
    const response = middleware(new NextRequest('https://writeoffapp.com/'));
    for (const directive of directives) {
      expect(sources(response, directive)).not.toEqual(expect.arrayContaining([expect.stringMatching(/googletagmanager|google-analytics|analytics\.google/)]));
    }
    expect(sources(response, 'script-src')).toContain('https://apis.google.com');
  });

  it('admits the gtag.js origins in script-src, img-src and connect-src only when the ID is set', () => {
    vi.stubEnv('NEXT_PUBLIC_GA_MEASUREMENT_ID', 'G-TESTTAG12');
    vi.stubEnv('NEXT_PUBLIC_APP_ENV', 'production');
    const response = middleware(new NextRequest('https://writeoffapp.com/'));
    expect(sources(response, 'script-src')).toEqual(expect.arrayContaining([...GOOGLE_TAG_CSP_SOURCES.scriptSrc]));
    expect(sources(response, 'img-src')).toEqual(expect.arrayContaining([...GOOGLE_TAG_CSP_SOURCES.imgSrc]));
    expect(sources(response, 'connect-src')).toEqual(expect.arrayContaining([...GOOGLE_TAG_CSP_SOURCES.connectSrc]));
    expect(sources(response, 'frame-src')).not.toEqual(expect.arrayContaining(googleOrigins));
    expect(sources(response, 'default-src')).toEqual(["'self'"]);
    expect(sources(response, 'frame-ancestors')).toEqual(["'none'"]);
  });

  it('keeps the staging site free of Google tag origins even when an ID is configured', () => {
    vi.stubEnv('NEXT_PUBLIC_GA_MEASUREMENT_ID', 'G-TESTTAG12');
    vi.stubEnv('NEXT_PUBLIC_APP_ENV', 'staging');
    const response = middleware(new NextRequest('https://staging.writeoffapp.com/'));
    for (const directive of directives) expect(sources(response, directive)).not.toEqual(expect.arrayContaining(googleOrigins));
  });

  it.each([
    [{ NEXT_PUBLIC_GA_MEASUREMENT_ID: ' g-abc123 ' }, 'G-ABC123'],
    [{ NEXT_PUBLIC_GA_MEASUREMENT_ID: 'G-1P3GNBHB9J' }, 'G-1P3GNBHB9J'],
    [{ NEXT_PUBLIC_GA_MEASUREMENT_ID: 'UA-12345-1' }, null],
    [{ NEXT_PUBLIC_GA_MEASUREMENT_ID: 'G-abc;alert(1)' }, null],
    [{ NEXT_PUBLIC_GA_MEASUREMENT_ID: '' }, null],
    [{}, null],
    [{ NEXT_PUBLIC_GA_MEASUREMENT_ID: 'G-ABC123', NEXT_PUBLIC_APP_ENV: 'staging' }, null],
  ])('validates the measurement ID %j → %s', (env, expected) => {
    expect(gaMeasurementId(env)).toBe(expected);
  });

  it('renders no hard-coded measurement ID in the root layout and loads the tag only through the route-aware component', () => {
    const layout = readFileSync(new URL('../app/layout.tsx', import.meta.url), 'utf8');
    expect(layout).not.toMatch(/['"`]G-[A-Z0-9]{4,}/);
    expect(layout).toContain('gaMeasurementId()');
    expect(layout).toMatch(/\{measurementId && <GoogleTag measurementId=\{measurementId\} \/>\}/);
    expect(layout).not.toContain('googletagmanager');
    const tag = readFileSync(new URL('../components/analytics/google-tag.tsx', import.meta.url), 'utf8');
    // Both the script URL and the inline config use the validated value, never a literal; automatic page views are off.
    expect(tag).toContain('gtag/js?id=${encodeURIComponent(measurementId)}');
    expect(tag).toContain("gtag('config', ${JSON.stringify(measurementId)}, { send_page_view: false");
    expect(tag).toContain('if (!allowed) return null;');
  });
  it.each([
    ['/', true], ['/blog/quarterly-taxes', true], ['/tools/1099-tax-calculator', true], ['/privacy', true], ['/resources/freelance-expense-reset', true],
    ['/protected', false], ['/protected/settings', false], ['/auth/login', false], ['/login', false], ['/stripe/success', false], ['/onboarding', false],
    ['/plaid/oauth', false], ['/api/tax/compute-1040', false], ['/protectedish', true], [null, false], ['relative', false],
  ])('analytics on %s → %s', (pathname, expected) => {
    expect(analyticsAllowedOnPath(pathname)).toBe(expected);
  });
});
