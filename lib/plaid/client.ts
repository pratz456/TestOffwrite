import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid'

import { getPlaidConfig } from './config';

const { plaidClientId, plaidSecret, plaidEnv } = getPlaidConfig();

// Plaid client configuration
const configuration = new Configuration({
  basePath: PlaidEnvironments[plaidEnv as keyof typeof PlaidEnvironments] || PlaidEnvironments.sandbox,
  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': plaidClientId || '',
      'PLAID-SECRET': plaidSecret || '',
    },
  },
})

export const plaidClient = new PlaidApi(configuration) 