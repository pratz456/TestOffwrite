/**
 * The 1099-K "not business income" decision is off unless this is exactly "1".
 * Other reconciliation changes (no default choice, the guide question, export
 * guidance, copy, and legacy re-confirm) are not behind this flag.
 * Read at call time so tests and the dev server can turn it on without a rebuild
 * of this module's other exports. Next inlines NEXT_PUBLIC_ access on the client.
 */
export function kNotBusinessIncomeEnabled(): boolean {
  return process.env.NEXT_PUBLIC_RECONCILIATION_K_NOT_BUSINESS_INCOME === '1';
}
