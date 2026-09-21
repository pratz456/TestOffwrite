import { describe, expect, it } from 'vitest';
import { validateStagingConfiguration } from '../scripts/staging-preflight.mjs';
const project = 'writeoff-production-testing';
const env = { WRITEOFF_ENV: 'staging', NEXT_PUBLIC_APP_ENV: 'staging', NEXT_PUBLIC_FIREBASE_PROJECT_ID: project,
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: `${project}.firebasestorage.app`, NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: `${project}.firebaseapp.com`,
  NEXT_PUBLIC_SITE_URL: `https://${project}.web.app`, PLAID_ENV: 'sandbox', SSN_ENCRYPTION_KEY: '1'.repeat(64),
  PLAID_CLIENT_ID: 'synthetic-client', PLAID_SECRET: 'synthetic-private-value' };
const target = { project, hosting: { site: project } };
describe('bank deployment encryption requirements', () => {
  it.each([undefined, '', 'short', 'z'.repeat(64)])('blocks enabled bank credentials without a usable dedicated encryption key (%s)', key => {
    const result = validateStagingConfiguration({ ...env, PLAID_TOKEN_ENCRYPTION_KEY: key }, target);
    expect(result.errors).toContain('PLAID_TOKEN_ENCRYPTION_KEY must be configured before bank connections are enabled');
    expect(JSON.stringify(result)).not.toContain(env.PLAID_SECRET);
  });
  it('accepts complete isolated Sandbox configuration', () => {
    expect(validateStagingConfiguration({ ...env, PLAID_TOKEN_ENCRYPTION_KEY: '2'.repeat(64) }, target).errors).toEqual([]);
  });
});
