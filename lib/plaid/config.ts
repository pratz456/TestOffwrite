type Environment = Record<string, string | undefined>;
type LegacyPlaidConfig = { client_id?: string; clientId?: string; secret?: string; env?: string };

function legacyPlaidConfig(): LegacyPlaidConfig {
  try {
    // Older production deployments may still use Firebase runtime config.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const functions = require('firebase-functions');
    return functions.config()?.plaid || {};
  } catch { return {}; }
}

export function getPlaidConfig(
  env: Environment = process.env,
  readLegacy: () => LegacyPlaidConfig = legacyPlaidConfig,
  preferEnvironment = false,
) {
  if (env.WRITEOFF_ENV === 'staging') {
    if (env.PLAID_ENV && env.PLAID_ENV !== 'sandbox') throw new Error('Staging isolation: PLAID_ENV must be sandbox');
    // Never fall back to a legacy production secret, even when sandbox keys are pending.
    return { plaidClientId: env.PLAID_CLIENT_ID, plaidSecret: env.PLAID_SECRET, plaidEnv: 'sandbox' };
  }
  const legacy = preferEnvironment && env.PLAID_CLIENT_ID && env.PLAID_SECRET ? {} : readLegacy();
  const legacyClientId = legacy.client_id || legacy.clientId;
  return preferEnvironment ? {
    plaidClientId: env.PLAID_CLIENT_ID || legacyClientId,
    plaidSecret: env.PLAID_SECRET || legacy.secret,
    plaidEnv: env.PLAID_ENV || legacy.env || 'sandbox',
  } : {
    plaidClientId: legacyClientId || env.PLAID_CLIENT_ID,
    plaidSecret: legacy.secret || env.PLAID_SECRET,
    plaidEnv: legacy.env || env.PLAID_ENV || 'sandbox',
  };
}
