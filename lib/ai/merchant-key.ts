/**
 * Client-safe merchant key shared by the learning engine, bulk confirmation and
 * the review UI. Analysis input names the payee `merchant`; stored transactions
 * use `merchant_name` (Plaid) or `name`. Patterns are keyed by the same
 * lower-cased value regardless of which field a caller supplies.
 */
export function learningMerchantKey(transactionData: unknown): string | undefined {
  if (!transactionData || typeof transactionData !== 'object') return undefined;
  const record = transactionData as Record<string, unknown>;
  for (const field of ['merchant_name', 'merchant', 'name'] as const) {
    const value = record[field];
    if (typeof value === 'string' && value.trim()) return value.trim().toLowerCase();
  }
  return undefined;
}
