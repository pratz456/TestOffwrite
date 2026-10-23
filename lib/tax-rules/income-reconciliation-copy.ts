/**
 * Owner-facing reconciliation copy. Every string is PENDING APPROVAL
 * except RECONCILE_BUTTON, which already appears on the tax preview.
 * No em dashes. {tokens} are filled by fillIncomeCopy.
 */

export const NO_CHOICE_YET = 'Choose how these records relate. WriteOff does not choose for you.';
export const STALE_APP_REFRESH = 'This page is out of date. Refresh the page and choose again.';

export const GUIDE_QUESTION = 'Did this client pay you by card, PayPal, Venmo or another payment app?';
export const GUIDE_ANSWER_APP = 'Yes, by card or a payment app';
export const GUIDE_ANSWER_BANK = 'No, by check, ACH or wire';
export const GUIDE_ANSWER_NOT_SURE = 'Not sure';
export const GUIDE_HINT_APP = 'Card and payment app payments are reported on a 1099-K, not a 1099-NEC. If you have both forms for this work, they may report the same payments. Compare the amounts, then choose.';
export const GUIDE_HINT_BANK = 'Check, ACH and wire payments are not reported on a 1099-K. A 1099-NEC for this work is more likely separate income. Compare the amounts, then choose.';
export const GUIDE_HINT_NOT_SURE = 'Check the client\'s payment records or your bank statement. If you still can\'t tell, ask your tax preparer before you choose.';

export const DECISION_LABEL_NOT_BUSINESS = '1099-K includes amounts that are not business income';
export const DECISION_HELP_NOT_BUSINESS = 'The 1099-K gross includes refunds you gave customers, or money that was not business income. Enter each amount. The parts must add up to the 1099-K gross.';
export const REASON_REFUNDS = 'Refunds or credits to customers';
export const REASON_REFUNDS_HELP = 'Goes on Schedule C line 2, returns and allowances.';
export const REASON_PERSONAL = 'Personal, not business';
export const REASON_PERSONAL_HELP = 'Gifts, money back from friends, or personal items you sold for less than you paid. This is not business income, so it is not on your Schedule C.';
export const REASON_ERROR = 'Form sent in error: it repeats payments already counted, or it isn\'t yours.';

export const ERR_NOT_BUSINESS_NEEDS_ONE_K = 'Select exactly one 1099-K, and the deposits or direct income that report its business part.';
export const ERR_REASON_REQUIRED = 'Choose at least one reason and enter its amount.';
export const ERR_REASON_AMOUNT = 'Enter an amount over $0 for each reason you checked.';
export const ERR_PARTS_EXCEED_GROSS = 'Refunds, personal amounts and fees add up to {parts}, which is more than the 1099-K gross of {gross}.';
export const ERR_SELECT_BUSINESS_RECORDS = 'Select the deposits or direct income for the business part of this 1099-K ({business}).';
export const ERR_SUM_MISMATCH = 'The parts don\'t add up to the 1099-K gross of {gross}: {kind} {selected} + refunds or credits {refunds} + personal {personal} + fees {fee} = {total}.';
export const OUTSIDE_SC_NOTE = 'This is not business income, so it is not on your Schedule C. If the 1099-K was sent in error, or covers personal items you sold for less than you paid, the amount goes on the 1099-K adjustment entry at the top of Schedule 1, so it adds no tax. If you sold personal items for more than you paid, the gain is taxable; ask your tax preparer. Ask the issuer for a corrected 1099-K, keep your records, and file without waiting for the correction.';

export const EXPORT_BLOCKED_TITLE = 'One step before your Schedule C';
export const EXPORT_BLOCKED_BODY = 'Some of your income records may describe the same payments. Tell us how they relate, and your Schedule C worksheet will count each one once.';
export const EXPORT_BLOCKED_SAFE = 'Your records are saved and nothing was changed.';
export const RECONCILE_BUTTON = 'Reconcile income sources';
export const RETRY_EXPORT = 'Try the export again';

export const PANEL_FORMS_NOTE = 'All business income is taxable, whether or not you get a 1099. For 2025 and later, a payment app or marketplace is required to send a 1099-K only when your payments are over $20,000 and over 200 transactions. Some send one anyway. Card payments have no threshold. A 1099-K shows gross amounts, before fees, refunds and credits.';
export const NO_FORM_NO_INCOME = 'No form doesn\'t mean no income. Your bank deposits are the main record of what you earned. 1099s are only a cross-check. For payments made in 2026, clients don\'t have to send a 1099-NEC below $2,000.';
export const PANEL_SUMMARY_COUNTED = 'Built from {n} records and {m} saved decisions. Records you reconciled count once.';

export const LEGACY_RECONFIRM_TITLE = 'Please confirm this decision';
export const LEGACY_RECONFIRM_BODY = 'We changed how this choice works, so we\'re asking once: do these records describe the same payments? If one is a separate payment, change your answer.';
export const LEGACY_RECONFIRM_YES = 'Yes, same payments';
export const LEGACY_RECONFIRM_CHANGE = 'No, change my answer';

export const SEPARATE_MULTI_PREVIEW = 'Each of these {n} records counts as its own income. Total counted: {total}.';
export const CONFIRM_SAME_TITLE = 'Count these forms once?';
export const CONFIRM_SAME_BODY = 'Your forms report {reported}. We\'ll count {counted} on line 1.';
export const CONFIRM_SAME_DETAIL = 'Only continue if these forms report the same payments. If a form is for different work, go back and choose separate income.';
export const CONFIRM_SAME_YES = 'Yes, count {counted}';
export const CONFIRM_SAME_BACK = 'Go back';
export const CONFIRM_FORMS_REQUIRED = 'Confirm the form totals before saving. Refresh the page and try again.';
export const COMPARE_TITLE = 'Compare the two forms';
export const COMPARE_ROW_FORM = 'Form';
export const COMPARE_ROW_PAYER = 'Payer';
export const COMPARE_ROW_AMOUNT = 'Amount';
export const COMPARE_DIFF = 'These forms differ by {diff}.';
export const COMPARE_SAME_AMOUNT = 'These forms show the same amount. That alone doesn\'t mean they report the same payments.';
export const ERR_SAME_NEEDS_K = 'Two 1099-NECs usually report different payments, so you can\'t count them once here. If one corrects the other, choose "A client sent a corrected 1099-NEC". If a client sent the same form twice, ask them which one is right.';
/** Review warning. It follows legacyNecReopen on every surface. PENDING APPROVAL. */
export const LEGACY_NEC_WARNING = 'Two 1099-NECs are usually separate income. Review this match.';
/** Shown when legacyNecReopen reopens a current-year NEC-only same-payments decision. PENDING APPROVAL. */
export const LEGACY_NEC_REOPEN_REASON = 'Two 1099-NECs are usually separate income, so both count.';
/** One-time notice beside a reopened current-year decision. PENDING APPROVAL. */
export const LEGACY_NEC_CHANGE_NOTICE = 'We used to count these two 1099-NECs once. Two 1099-NECs are usually separate income, so both now count, and your total and quarterly estimate may go up.';
/** Shown when legacyNecReopen flags a prior-year same-payments decision without changing its total. PENDING APPROVAL. */
export const LEGACY_NEC_PRIOR_YEAR_NOTE = 'If this was on a return you already filed, the IRS explains how to correct it at irs.gov/form1040x.';
export const SAME_DISABLED_NEC = 'Not available for two 1099-NECs. They usually report different payments.';
export const DECISION_LABEL_CORRECTED = 'A client sent a corrected 1099-NEC';
export const DECISION_HELP_CORRECTED = 'Use this when a client sent you a corrected 1099-NEC. We count the corrected form and keep the original in your records without counting it.';
export const CORRECTED_PICK_QUESTION = 'Which form is the corrected one?';
export const CORRECTED_PREVIEW = 'We\'ll count the corrected form, {corrected}. The original, {original}, stays in your records and is not counted.';
export const CORRECTED_ORIGINAL_BADGE = 'Original form. A corrected form was sent, so this one is kept but not counted.';
export const ERR_CORRECTED_NEEDS_TWO_NEC = 'Select exactly two 1099-NECs, the original and the corrected form, plus any deposits or direct income they report.';
export const ERR_CORRECTED_SAME_PAYER = 'A corrected form comes from the same payer, but these forms name {payerA} and {payerB}. If the payer name was typed differently, fix it on the form first.';
export const ERR_CORRECTED_PICK = 'Choose which form is the corrected one.';
export const ERR_CORRECTED_SUM = 'The {kind} you selected totals {selected}, but the corrected form reports {corrected}. They must match to the cent.';

/** Live sum while a 1099-K not-business decision is being entered. PENDING APPROVAL. */
export const LIVE_SUM_LINE = '1099-K gross {gross}, minus refunds or credits {refunds}, minus personal {personal}, minus fees {fee}, equals the business part {business}.';
export const LIVE_SUM_MATCH = 'The selected records match the business part.';
export const LIVE_SUM_DIFFER = 'The selected records do not match the business part yet.';

export const LINE_1_COUNTED = 'Counted {amount} on line 1';
export const LINE_2_AMOUNT = 'Line 2 {amount}';
export const OUTSIDE_SC_AMOUNT = 'Outside Schedule C, needs review {amount}';

/** A separate-income decision that pairs a form with a deposit or direct income. PENDING APPROVAL. */
export const ERR_SEPARATE_FORM_WITH_MONEY = 'Separate income can\'t include a 1099 together with a deposit or direct income. That counts the same money twice. Choose same payments, or the decision for the part of a 1099-K that is also on a 1099-NEC.';
/** Same block while the 1099-K switch is off, so it does not name the hidden partial overlap choice. PENDING APPROVAL. */
export const ERR_SEPARATE_SAME_PAYMENTS_ONLY = 'Separate income can\'t include a 1099 together with a deposit or direct income. That counts the same money twice. Choose same payments.';

export const DECISION_LABEL_PARTIAL = 'Part of the 1099-K is also on the 1099-NEC';
export const DECISION_HELP_PARTIAL = 'Enter the amount that is on both the 1099-K and the 1099-NEC. That shared amount counts once. The rest of each form counts too.';
export const ERR_PARTIAL_NEEDS_K_AND_NEC = 'Select exactly one 1099-K and one 1099-NEC for the overlapping amount.';
export const ERR_PARTIAL_OVERLAP = 'Enter an overlapping amount greater than $0 and no more than the smaller form ({smaller}).';
/** Deposits on a partial overlap are claimed and not added again. PENDING APPROVAL. */
export const ERR_PARTIAL_DEPOSITS = 'Deposits included here total {deposits}, which is more than the income counted from the two forms ({total}). Those deposits are not added again. Remove a deposit that is not already part of these forms.';
export const PARTIAL_OVERLAP_PREVIEW = 'The overlapping {overlap} counts once. Total counted: {total}.';

/** Inline labels and errors moved out of the screens. Each one follows the switch named in the PR. */
export const SELECTED_1099_FORMS = 'Selected 1099 forms';
export const ERR_PARTS_ON_K_ONLY = 'Refund and personal amounts can only be recorded on the 1099-K decision for amounts that are not business income.';
export const ERR_CORRECTED_FEE = 'A corrected 1099-NEC does not record a platform fee.';
export const ERR_PARTIAL_FEE = 'A partial overlap does not record a platform fee.';
export const PARTIAL_OVERLAP_AMOUNT = 'Amount on both forms ($)';
export const DISMISS_NOTICE = 'Dismiss';
export const RETURNS_AND_ALLOWANCES = 'Returns and allowances';
export const NET_RECEIPTS = 'Net receipts';
export const ERR_PARTIAL_DEPOSIT_NOT_SHARED = 'A deposit of {deposits} is not part of the shared amount ({overlap}) and does not match either form. Remove it, or include the bank record of one form.';
/** The invalid-body sentence from 7a8ba53. Used while the guided switch is off. */
export const INVALID_DECISION_BODY = 'Provide the tax year, a decision type (same_payments, separate_income or k_includes_fees) and the records it covers with their current amounts.';
/** Separate income of one record, the base rule, used while the guided switch is off. */
export const ONE_RECORD_SEPARATE = 'Mark one record at a time as separate income.';

export function fillIncomeCopy(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{([A-Za-z]+)\}/g, (_, key: string) => {
    const value = values[key];
    return value === undefined ? `{${key}}` : String(value);
  });
}
