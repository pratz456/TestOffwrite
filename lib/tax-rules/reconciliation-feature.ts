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

/**
 * R10.5. Off unless this is exactly "1".
 * When off, a saved same-payments decision that joins only 1099-NECs keeps counting.
 * When on, that saved decision stops applying and comes back as a conflict.
 * New saves of that decision are rejected either way.
 * Read at call time, same as the not-business flag. Turning this on changes existing
 * totals and can block an export with a 422. It stays off until Pratham says otherwise.
 */
export function legacyNecSamePaymentsReopenEnabled(): boolean {
  return process.env.NEXT_PUBLIC_RECONCILIATION_R10_5_LEGACY_NEC_REOPEN === '1';
}
