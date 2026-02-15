/**
 * Plaid debug logging. Only active when DEBUG_PLAID=true to avoid noisy production logs.
 */

const DEBUG = process.env.DEBUG_PLAID === 'true';

export function debugPlaid(message: string, data?: Record<string, unknown>): void {
  if (!DEBUG) return;
  if (data) {
    console.log(`[DEBUG_PLAID] ${message}`, JSON.stringify(data, null, 0));
  } else {
    console.log(`[DEBUG_PLAID] ${message}`);
  }
}

/**
 * Log the request payload sent to Plaid (transactionsGet or transactionsSync).
 * Use before calling the API to verify start_date, end_date, options.account_ids, etc.
 */
export function logPlaidRequest(
  label: string,
  payload: {
    endpoint: 'transactionsGet' | 'transactionsSync';
    start_date?: string;
    end_date?: string;
    options?: Record<string, unknown>;
    access_token?: string;
    cursor?: string;
    item_id?: string;
    institution_id?: string;
    account_ids?: string[];
    env?: string;
  }
): void {
  if (!DEBUG) return;
  const { access_token, ...rest } = payload;
  const safe = {
    ...rest,
    access_token: access_token ? '[REDACTED]' : undefined,
    env: payload.env ?? process.env.PLAID_ENV ?? 'unknown',
  };
  console.log(`[DEBUG_PLAID] ${label} request:`, JSON.stringify(safe, null, 2));
}
