import { describe, expect, it } from 'vitest';
import { isTrustedApplicationRequest } from '@/lib/security/request-origin';

const staging = { NEXT_PUBLIC_SITE_URL: 'https://writeoff-production-testing.web.app', NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'writeoff-production-testing' };
const proxied = (headers: Record<string, string>) => new Request('http://localhost:8080/api/auth/session', { method: 'POST', headers });

describe('application origin behind Firebase Hosting', () => {
  it('accepts configured HTTPS staging origin despite the internal upstream URL', () => {
    expect(isTrustedApplicationRequest(proxied({ origin: staging.NEXT_PUBLIC_SITE_URL }), staging)).toBe(true);
  });
  it('accepts the current project Firebase auth hosting alias', () => {
    expect(isTrustedApplicationRequest(proxied({ origin: 'https://writeoff-production-testing.firebaseapp.com' }), staging)).toBe(true);
  });
  it('rejects a foreign origin even with forged forwarding headers', () => {
    expect(isTrustedApplicationRequest(proxied({ origin: 'https://attacker.example', 'x-forwarded-host': 'attacker.example', 'x-forwarded-proto': 'https' }), staging)).toBe(false);
  });
  it('rejects explicit cross-site requests and null origins', () => {
    expect(isTrustedApplicationRequest(proxied({ origin: staging.NEXT_PUBLIC_SITE_URL, 'sec-fetch-site': 'cross-site' }), staging)).toBe(false);
    expect(isTrustedApplicationRequest(proxied({ origin: 'null' }), staging)).toBe(false);
  });
  it('does not trust production from staging or similarly named hosts', () => {
    for (const origin of ['https://writeoffapp.com', 'https://writeoff-23910.web.app', `${staging.NEXT_PUBLIC_SITE_URL}.attacker.example`]) {
      expect(isTrustedApplicationRequest(proxied({ origin }), staging)).toBe(false);
    }
  });
  it('supports both configured WriteOff production aliases', () => {
    const production = { NEXT_PUBLIC_SITE_URL: 'https://writeoffapp.com' };
    expect(isTrustedApplicationRequest(proxied({ origin: 'https://www.writeoffapp.com' }), production)).toBe(true);
  });
  it('preserves direct same-origin and non-browser requests', () => {
    expect(isTrustedApplicationRequest(new Request('http://localhost:3100/api/auth/session', { headers: { origin: 'http://localhost:3100' } }), {})).toBe(true);
    expect(isTrustedApplicationRequest(proxied({}), staging)).toBe(true);
  });
});
