import { describe, expect, it } from 'vitest';
import { assertScheduledBankConfig, currentBankUsers } from '../functions/src/sync-config';

const staging = { project: 'writeoff-production-testing', origin: 'https://writeoff-production-testing.web.app',
  clientId: 'new-client', environment: 'sandbox', secret: 's'.repeat(32) };
describe('scheduled bank sync isolation and provider selection', () => {
  it('accepts explicit staging Sandbox and production configurations', () => {
    expect(() => assertScheduledBankConfig(staging)).not.toThrow();
    expect(() => assertScheduledBankConfig({ ...staging, project: 'writeoff-23910', origin: 'https://writeoffapp.com', environment: 'production' })).not.toThrow();
  });
  it.each([
    { project: undefined }, { project: 'unapproved-project' }, { origin: '' }, { origin: 'https://writeoffapp.com' },
    { origin: 'https://attacker.invalid' }, { origin: 'http://writeoff-production-testing.web.app' },
    { origin: 'https://user:password@writeoff-production-testing.web.app' },
    { origin: 'https://writeoff-production-testing.web.app/path' }, { origin: 'https://writeoff-production-testing.web.app?redirect=old' },
    { environment: 'production' }, { environment: '' }, { clientId: '' }, { clientId: ' ' }, { secret: 'short' },
  ])('rejects unsafe scheduled configuration %j', patch => {
    expect(() => assertScheduledBankConfig({ ...staging, ...patch })).toThrow('BANK_SYNC_CONFIGURATION_REQUIRED');
  });
  it('does not allow Sandbox in the production project', () => {
    expect(() => assertScheduledBankConfig({ ...staging, project: 'writeoff-23910', origin: 'https://writeoffapp.com' })).toThrow();
  });
  it('selects only current-account, current-environment active users and deduplicates banks', () => {
    const row = { status: 'active', uid: 'current-user', clientId: 'new-client', environment: 'sandbox' };
    expect(currentBankUsers([row, { ...row }, { ...row, uid: 'second-user' },
      { ...row, uid: 'old-client-user', clientId: 'retired-client' }, { ...row, uid: 'wrong-env-user', environment: 'production' },
      { ...row, uid: 'inactive-user', status: 'relink_required' }, { ...row, uid: 'disconnected-user', status: 'disconnected' },
      { ...row, uid: '../other-user' }, { ...row, uid: '' }, { ...row, uid: undefined },
      { uid: 'legacy-user', plaid_token: 'legacy-token' }], staging)).toEqual(['current-user', 'second-user']);
  });
  it('refuses selection under an invalid app/provider pairing', () => {
    expect(() => currentBankUsers([], { ...staging, origin: 'https://writeoffapp.com' })).toThrow();
  });
});
