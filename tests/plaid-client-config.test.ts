import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ construct: vi.fn(), request: vi.fn() }));
vi.mock('plaid', () => ({
  Configuration: class { constructor(options: unknown) { Object.assign(this, options); } },
  PlaidApi: class {
    constructor(readonly configuration: unknown) { mock.construct(configuration); }
    itemGet(input: unknown) { mock.request(this.configuration, input); return Promise.resolve({ data: {} }); }
  },
  PlaidEnvironments: { sandbox: 'https://sandbox.plaid.test', production: 'https://production.plaid.test' },
}));
import { plaidClient } from '@/lib/plaid/client';

beforeEach(() => {
  vi.clearAllMocks();
  for (const name of ['WRITEOFF_ENV', 'NEXT_PUBLIC_APP_ENV', 'GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT', 'GCP_PROJECT',
    'FIREBASE_ADMIN_PROJECT_ID', 'NEXT_PUBLIC_FIREBASE_PROJECT_ID', 'FIREBASE_CONFIG', 'NEXT_PUBLIC_SITE_URL', 'PLAID_ENV', 'PLAID_CLIENT_ID', 'PLAID_SECRET']) vi.stubEnv(name, '');
  vi.stubEnv('NODE_ENV', 'test');
});
afterEach(() => vi.unstubAllEnvs());
describe('Plaid client configuration boundaries', () => {
  it('does not initialize or call Plaid with an implicit environment', () => {
    expect(() => plaidClient.itemGet({ access_token: 'synthetic-token' })).toThrow('PLAID_ENV must explicitly');
    expect(mock.construct).not.toHaveBeenCalled();
    expect(mock.request).not.toHaveBeenCalled();
  });
  it.each(['PLAID_CLIENT_ID', 'PLAID_SECRET'])('rejects a missing %s before constructing a provider client', name => {
    vi.stubEnv('PLAID_ENV', 'sandbox'); vi.stubEnv('PLAID_CLIENT_ID', 'new-client'); vi.stubEnv('PLAID_SECRET', 'new-secret');
    vi.stubEnv(name, '');
    expect(() => plaidClient.itemGet({ access_token: 'synthetic-token' })).toThrow('credentials are not configured');
    expect(mock.request).not.toHaveBeenCalled();
  });
  it('binds methods to the explicit endpoint and re-reads replacement keys for the next operation', async () => {
    vi.stubEnv('PLAID_ENV', 'sandbox'); vi.stubEnv('PLAID_CLIENT_ID', 'new-client'); vi.stubEnv('PLAID_SECRET', 'new-secret');
    await plaidClient.itemGet({ access_token: 'synthetic-token' });
    expect(mock.request.mock.calls[0][0]).toMatchObject({ basePath: 'https://sandbox.plaid.test',
      baseOptions: { headers: { 'PLAID-CLIENT-ID': 'new-client', 'PLAID-SECRET': 'new-secret' } } });
    vi.stubEnv('PLAID_SECRET', 'replacement-secret');
    await plaidClient.itemGet({ access_token: 'synthetic-token' });
    expect(mock.request.mock.calls[1][0].baseOptions.headers['PLAID-SECRET']).toBe('replacement-secret');
  });
  it('refuses Sandbox on the production application before a request', () => {
    vi.stubEnv('WRITEOFF_ENV', 'production'); vi.stubEnv('PLAID_ENV', 'sandbox');
    expect(() => plaidClient.itemGet({ access_token: 'synthetic-token' })).toThrow('Production banking');
    expect(mock.request).not.toHaveBeenCalled();
  });
});
