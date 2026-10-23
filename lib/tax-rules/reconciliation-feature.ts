import { LATEST_PUBLISHED_TAX_YEAR } from './federal-year-rules';

/**
 * The 1099-K "not business income" decision, a partial overlap between a
 * 1099-K and a 1099-NEC, the payment-app guide, and the 1099-K threshold note
 * are off unless this is exactly "1".
 * The separate-income block on a 1099 together with a deposit or direct income
 * stays on either way. While this switch is off, that block uses the existing
 * unlinked-sources sentence.
 * Read at call time so tests and the dev server can turn it on without a rebuild
 * of this module's other exports. Next inlines NEXT_PUBLIC_ access on the client.
 */
export function kNotBusinessIncomeEnabled(): boolean {
  return process.env.NEXT_PUBLIC_RECONCILIATION_K_NOT_BUSINESS_INCOME === '1';
}

/** New saves of these decisions are rejected, and the Reconcile tab hides them, unless the 1099-K switch is on. */
export function reconciliationDecisionNeedsKSwitch(decision: string): boolean {
  return decision === 'k_not_business_income' || decision === 'partial_overlap';
}

/**
 * Legacy 1099-NEC reopen switch `legacyNecReopen`. Off unless the environment value is exactly "1".
 * Off: a saved same-payments decision that joins two or more 1099-NECs keeps counting.
 * The Reconcile tab does not show the review warning, the two-NEC explanation,
 * the corrected 1099-NEC decision, or the no-form note. Export is not blocked.
 * A new save of two or more 1099-NEC same payments is still rejected. While this
 * switch is off, that rejection uses the existing unlinked-sources sentence.
 * On, current year, forms only: that decision reopens as a conflict, both forms count, and export can 422.
 * On, 2025 or earlier: every legacy same-payments shape keeps its saved total and a filing note is shown.
 * Read at call time. Off by default. Server code reads this. The Reconcile tab follows the summary flag.
 */
export function legacyNecReopen(): boolean {
  return process.env.legacyNecReopen === '1';
}

/**
 * Asks once about a same_payments decision saved before this release.
 * Off unless the environment value is exactly "1".
 * Off: every saved or confirmed decision counts as it did before, and export
 * does not gain a 422 for that decision. The Reconcile tab does not ask again,
 * and it does not show the new confirm step, the two-form compare, the
 * separate-income preview, or the guided export card. A missing explicit choice
 * is still refused. While this switch is off, that refusal uses the existing
 * invalid-body sentence.
 * On: a same_payments decision for the current tax year, with version missing or 1, asks once.
 * A year that may already be filed never asks. Confirming keeps the saved total.
 * Two or more 1099s on a new same-payments save ask for the form total.
 * Read at call time. Off by default. Server code reads this. The Reconcile tab follows the summary flag.
 */
export function legacyDecisionReconfirm(): boolean {
  return process.env.legacyDecisionReconfirm === '1';
}

/** Switches the Reconcile tab and the export card read from the server payload. */
export interface ReconciliationFeatures {
  kNotBusinessIncome: boolean;
  legacyNecReopen: boolean;
  legacyDecisionReconfirm: boolean;
}

export function reconciliationFeatures(): ReconciliationFeatures {
  return {
    kNotBusinessIncome: kNotBusinessIncomeEnabled(),
    legacyNecReopen: legacyNecReopen(),
    legacyDecisionReconfirm: legacyDecisionReconfirm(),
  };
}

/** The guided export card is the legacyDecisionReconfirm surface. Absent means off. */
export function reconciliationExportCardEnabled(body: { features?: { legacyDecisionReconfirm?: boolean } } | null | undefined): boolean {
  return body?.features?.legacyDecisionReconfirm === true;
}

/** A year before the latest published tax year may already be on a filed return. */
export function reconciliationYearMayAlreadyBeFiled(taxYear: number): boolean {
  return taxYear < LATEST_PUBLISHED_TAX_YEAR;
}
