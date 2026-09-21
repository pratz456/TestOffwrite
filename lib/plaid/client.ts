import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid';
import { getPlaidConfig } from './config';

/** Read configuration when a bank operation runs, not while unrelated routes load. */
export function createPlaidClient() {
  const { plaidClientId, plaidSecret, plaidEnv } = getPlaidConfig();
  if (!plaidClientId || !plaidSecret) throw new Error('Plaid credentials are not configured');
  return new PlaidApi(new Configuration({
    basePath: PlaidEnvironments[plaidEnv],
    baseOptions: { headers: { 'PLAID-CLIENT-ID': plaidClientId, 'PLAID-SECRET': plaidSecret } },
  }));
}

// Preserve existing consumers while preventing a default Sandbox or blank-key client.
// A new instance per operation also prevents a warm process from pinning old keys.
export const plaidClient = new Proxy({} as PlaidApi, {
  get(_target, property) {
    const client = createPlaidClient();
    const value = Reflect.get(client, property);
    return typeof value === 'function' ? value.bind(client) : value;
  },
});
