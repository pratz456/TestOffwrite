import { LATEST_PUBLISHED_TAX_YEAR } from './federal-year-rules';

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
 * R10.5 switch `r10_5LegacyNecReopen`. Off unless the environment value is exactly "1".
 * Off: a saved same-payments decision that joins only 1099-NECs keeps counting, and the
 * Reconcile tab shows a non-blocking warning. Export is not blocked.
 * On, current year: that decision reopens as a conflict, both forms count, and export can 422.
 * On, 2025 or earlier: the saved total stays and a filing note is shown.
 * New saves of that decision are rejected either way.
 * Read at call time. Off by default.
 */
export function r10_5LegacyNecReopen(): boolean {
  return process.env.r10_5LegacyNecReopen === '1';
}

/** A year before the latest published tax year may already be on a filed return. */
export function reconciliationYearMayAlreadyBeFiled(taxYear: number): boolean {
  return taxYear < LATEST_PUBLISHED_TAX_YEAR;
}
