/**
 * Customer-facing copy for the first-run estimated payment planner card.
 * Pending Pratham's approval. Not approved copy.
 */

export const PLANNER_CARD_TITLE = 'Plan your next estimated payment';

export const PLANNER_CARD_INTRO = 'Answer a few questions about last year\'s federal return and this year\'s payments. We\'ll show what to pay by {nextDueDate} to stay within the IRS safe harbor. Federal only. State estimated tax is not included.';

export const PLANNER_FILING_STATUS_LABEL = 'Filing status for {taxYear}';
export const PLANNER_FILING_STATUS_PROFILE = 'From your profile';

export const PLANNER_TWELVE_MONTH_LABEL = 'Did your federal return for {lastYear} cover all 12 months?';
export const PLANNER_TWELVE_MONTH_HELPER = 'Choose No if you have no return for {lastYear}.';
export const PLANNER_ANSWER_YES = 'Yes';
export const PLANNER_ANSWER_NO = 'No';
export const PLANNER_ANSWER_NOT_SURE = 'Not sure';

export const PLANNER_RESIDENCY_LABEL = 'Were you a US citizen or resident for all of last year?';

export const PLANNER_LINE_24_LABEL = 'Total tax (Form 1040 line 24)';
export const PLANNER_LINE_24_HELPER = 'From your {lastYear} federal return. Enter 0 if it showed no tax.';

export const PLANNER_CREDITS_LABEL = 'Refundable credits you claimed (earned income, additional child tax credit, refundable education credit, premium tax credit)';
export const PLANNER_CREDITS_HELPER = 'From the same return. Enter 0 if none.';

export const PLANNER_PRIOR_TAX_COMPUTED = 'Last year\'s total tax: {amount}, close to the IRS figure.';

export const PLANNER_AGI_LABEL = 'Last year\'s adjusted gross income (AGI)';
export const PLANNER_AGI_HELPER = 'From the same return. It decides whether your target is 100% or 110% of last year\'s tax.';

export const PLANNER_WITHHOLDING_LABEL = 'Federal income tax withholding you expect for the year (W-2 box 2 and any 1099 backup withholding)';
export const PLANNER_WITHHOLDING_HELPER = 'Leave blank if you have none.';
export const PLANNER_WITHHOLDING_FROM_W2 = 'Withholding from your W-2 records: {amount}';
export const PLANNER_WITHHOLDING_INCOME_LINK = 'Income';

export const PLANNER_PAYMENTS_LABEL = 'Estimated payments made so far this year';
export const PLANNER_PAYMENTS_HELPER = 'Leave this empty if you have not made any.';
export const PLANNER_ADD_PAYMENT = 'Add a payment';
export const PLANNER_PAYMENT_DATE = 'Payment date';
export const PLANNER_PAYMENT_AMOUNT = 'Payment amount';

export const PLANNER_PROJECTED_INCOME_LABEL = 'Expected business income this year, after expenses';

export const PLANNER_SHOW_PLAN = 'Show my plan';
export const PLANNER_NOT_NOW = 'Not now';
export const PLANNER_START = 'Start';
export const PLANNER_DISMISS = 'Dismiss';
export const PLANNER_SEE_FULL_PLAN = 'See full plan';

export const PLANNER_EMPTY = 'Add last year\'s numbers to see your plan.';

export const PLANNER_PENALTY_SENTENCE = 'Paying at least these amounts by each due date generally avoids the federal underpayment penalty for {taxYear}, based on what you entered. It isn\'t your final tax for the year, and state estimated taxes are separate.';

export const PLANNER_ANNUAL_PRIOR = 'Your safe-harbor amount for {taxYear}: {annualAmount}';
export const PLANNER_ANNUAL_CURRENT = 'Your safe-harbor amount for {taxYear}: {annualAmount}, based on 90% of this year\'s estimated tax.';
export const PLANNER_NEXT_PAYMENT = 'Next payment: {nextAmount} by {nextDueDate}';
export const PLANNER_BASIS_PRIOR = 'It is based on {percent} of last year\'s tax.';
export const PLANNER_COULD_BE_SMALLER = 'The 90% option could be smaller if your income is lower this year.';
export const PLANNER_ADD_INCOME_PAY_LESS = 'Add this year\'s income to see if you can pay less';

export const PLANNER_E1_MESSAGE = 'No estimated payments are required to avoid the federal underpayment penalty for {taxYear}.';

export const PLANNER_ZERO_TARGET_CASE1 = 'Your target based on last year is $0, because your {lastYear} tax after refundable credits was $0 or less.';
export const PLANNER_ZERO_TARGET_CASE2 = 'Answer the citizenship or residency question to finish your target based on last year.';

export const PLANNER_MISSING_FACTS = 'We need a bit more before we can show a number: {list}. You can add it here or later in Quarterly taxes.';
export const PLANNER_NO_TWELVE_MONTH = 'Without a full 12-month return for {lastYear}, your plan uses 90% of this year\'s tax.';
export const PLANNER_ADD_INCOME_SEE_IT = 'Add this year\'s income to see it.';
export const PLANNER_NOT_SURE = 'Check your {lastYear} return, or choose No to use this year\'s numbers instead.';
export const PLANNER_ALREADY_COVERED = 'Your withholding and payments so far already cover the amount due by {nextDueDate}.';

export const PLANNER_DE_MINIMIS = 'This year\'s estimated tax minus withholding is under $1,000, so estimated payments are not required by the regular method for {taxYear}.';

export const PLANNER_ERROR_NOT_A_NUMBER = 'Enter a dollar amount, like 8500.';
export const PLANNER_ERROR_NEGATIVE = 'This amount can\'t be below 0.';
export const PLANNER_ERROR_PAYMENT_DATE = 'Pick a date in {taxYear}, on or before today.';
export const PLANNER_ERROR_SAVE = 'We couldn\'t save your answers. Your entries are still here. Try again.';
export const PLANNER_ERROR_LOAD = 'We saved your answers but couldn\'t load your plan. Try again, or open Quarterly taxes.';

export const PLANNER_DISMISSED = 'You can find this anytime under Quarterly taxes.';
export const PLANNER_FOOTER = 'Federal only. Planning estimate from your answers, not a tax bill.';

export function plannerFill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ''));
}
