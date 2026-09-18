import { describe, expect, it, vi } from 'vitest';
import { getPlaidConfig } from '@/lib/plaid/config';

describe('explicit Plaid account and environment selection', () => {
  it.each([undefined, '', 'development', 'SANDBOX', 'invalid'])('rejects a missing or invalid environment %s', PLAID_ENV => {
    expect(() => getPlaidConfig({ PLAID_ENV, PLAID_CLIENT_ID: 'client', PLAID_SECRET: 'secret' })).toThrow('PLAID_ENV must explicitly');
  });
  it.each([{}, { PLAID_CLIENT_ID: 'new-client' }, { PLAID_SECRET: 'new-secret' }])('never restores a missing credential from Firebase runtime config %j', partial => {
    const legacy = vi.fn(() => ({ client_id: 'old-client', secret: 'old-secret', env: 'production' }));
    const result = getPlaidConfig({ PLAID_ENV: 'sandbox', ...partial }, legacy);
    expect(result.plaidClientId).toBe(partial.PLAID_CLIENT_ID);
    expect(result.plaidSecret).toBe(partial.PLAID_SECRET);
    expect(legacy).not.toHaveBeenCalled();
  });
  it.each([
    { WRITEOFF_ENV: 'production' }, { NEXT_PUBLIC_APP_ENV: 'production' }, { NODE_ENV: 'production' },
    { GCLOUD_PROJECT: 'writeoff-23910' }, { NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'writeoff-23910' },
    { FIREBASE_CONFIG: JSON.stringify({ projectId: 'writeoff-23910' }) },
    { NEXT_PUBLIC_SITE_URL: 'https://writeoffapp.com' }, { NEXT_PUBLIC_SITE_URL: 'https://www.writeoffapp.com' },
  ])('rejects Sandbox on a production app %j', marker => {
    expect(() => getPlaidConfig({ ...marker, PLAID_ENV: 'sandbox', PLAID_CLIENT_ID: 'new-client', PLAID_SECRET: 'new-secret' })).toThrow('Production banking');
  });
  it.each([
    { WRITEOFF_ENV: 'staging' }, { NEXT_PUBLIC_APP_ENV: 'staging' },
    { GCLOUD_PROJECT: 'writeoff-production-testing' }, { NEXT_PUBLIC_SITE_URL: 'https://writeoff-production-testing.web.app' },
  ])('rejects live banking on a staging app %j', marker => {
    expect(() => getPlaidConfig({ ...marker, PLAID_ENV: 'production' })).toThrow('PLAID_ENV must be sandbox');
  });
  it('rejects conflicting staging/production markers even with a valid provider environment', () => {
    expect(() => getPlaidConfig({ WRITEOFF_ENV: 'staging', GCLOUD_PROJECT: 'writeoff-23910', PLAID_ENV: 'sandbox' })).toThrow('markers conflict');
  });
  it('allows explicit Sandbox on staging, development, and isolated production-build previews', () => {
    for (const marker of [{ WRITEOFF_ENV: 'staging', NODE_ENV: 'production' }, { WRITEOFF_ENV: 'local', NODE_ENV: 'production' },
      { NEXT_PUBLIC_SITE_URL: 'http://127.0.0.1:3100', NODE_ENV: 'production' }, { GCLOUD_PROJECT: 'demo-writeoff-security', NODE_ENV: 'production' }]) {
      expect(getPlaidConfig({ ...marker, PLAID_ENV: 'sandbox' }).plaidEnv).toBe('sandbox');
    }
  });
  it('does not let localhost override a real production project marker', () => {
    expect(() => getPlaidConfig({ NEXT_PUBLIC_SITE_URL: 'http://localhost:3000', NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'writeoff-23910', PLAID_ENV: 'sandbox' })).toThrow('Production banking');
  });
  it('accepts explicitly configured production credentials and treats whitespace-only credentials as missing', () => {
    expect(getPlaidConfig({ WRITEOFF_ENV: 'production', PLAID_ENV: 'production', PLAID_CLIENT_ID: ' new-client ', PLAID_SECRET: ' new-secret ' }))
      .toEqual({ plaidClientId: 'new-client', plaidSecret: 'new-secret', plaidEnv: 'production' });
    expect(getPlaidConfig({ PLAID_ENV: 'sandbox', PLAID_CLIENT_ID: ' ', PLAID_SECRET: ' ' }))
      .toEqual({ plaidClientId: undefined, plaidSecret: undefined, plaidEnv: 'sandbox' });
  });
});
