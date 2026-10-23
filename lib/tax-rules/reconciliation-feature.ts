import { LATEST_PUBLISHED_TAX_YEAR } from './federal-year-rules';

/**
 * The 1099-K "not business income" decision and a partial overlap between a
 * 1099-K and a 1099-NEC are off unless this is exactly "1".
 * Read at call time so tests and the dev server can turn it on without a rebuild
 * of this module's other exports. Next inlines NEXT_PUBLIC_ access on the client.
 */
export function kNotBusinessIncomeEnabled(): boolean {
  return process.env.NEXT_PUBLIC_RECONCILIATION_K_NOT_BUSINESS_INCOME === '1';
}

/**
 * Guided reconciliation v1. Off unless this is exactly "1".
 * Off: the Reconcile tab, Schedule C export and tax preview read like the base release.
 * Separate income is one record. A guided export card does not appear.
 * On: no default decision, an explicit choice, the payment guide, the confirm step,
 * several records in one separate-income save, the form-and-deposit block, and the
 * corrected 1099-NEC decision.
 * A new same-payments save of two or more 1099-NECs is rejected only while this switch is on.
 * Read at call time. Next inlines NEXT_PUBLIC_ access on the client.
 */
export function guidedReconciliationV1Enabled(): boolean {
  return process.env.NEXT_PUBLIC_RECONCILIATION_GUIDED_V1 === '1';
}

/** New saves of these decisions are rejected, and the Reconcile tab hides them, unless the 1099-K switch is on. */
export function reconciliationDecisionNeedsKSwitch(decision: string): boolean {
  return decision === 'k_not_business_income' || decision === 'partial_overlap';
}

/**
 * Legacy 1099-NEC reopen switch `legacyNecReopen`. Off unless the environment value is exactly "1".
 * Off: a saved same-payments decision that joins two or more 1099-NECs keeps counting.
 * The review warning stays off the Reconcile tab, tax preview, Form 1040 notes and assistant notes.
 * Reopening a saved two 1099-NEC same-payments decision uses the guided switch rejection, so that rejection stays off while the guided switch is off.
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
 * does not gain a 422 for that decision. The Reconcile tab does not ask again.
 * On: a same_payments decision for the current tax year, with version missing or 1, asks once.
 * A year that may already be filed never asks. Confirming keeps the saved total.
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
  guidedV1: boolean;
}

export function reconciliationFeatures(): ReconciliationFeatures {
  return {
    kNotBusinessIncome: kNotBusinessIncomeEnabled(),
    legacyNecReopen: legacyNecReopen(),
    legacyDecisionReconfirm: legacyDecisionReconfirm(),
    guidedV1: guidedReconciliationV1Enabled(),
  };
}

/** The guided export card follows NEXT_PUBLIC_RECONCILIATION_GUIDED_V1. Absent means off. */
export function reconciliationExportCardEnabled(body: { features?: { guidedV1?: boolean } } | null | undefined): boolean {
  return body?.features?.guidedV1 === true;
}

/** A year before the latest published tax year may already be on a filed return. */
export function reconciliationYearMayAlreadyBeFiled(taxYear: number): boolean {
  return taxYear < LATEST_PUBLISHED_TAX_YEAR;
}
