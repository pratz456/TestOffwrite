import { expect } from 'vitest';
import { dashboardRecordStatus } from '@/lib/dashboard/record-summary';
import { aggregateScheduleC, categoryMapForTaxYear, type ScheduleCTransactionLike } from '@/lib/schedule-c/aggregate';
import { formatRecordedTransactionAmount } from '@/lib/transactions/amount-display';
import { prioritizeTransactionReview } from '@/lib/transactions/review-priority';
import { transactionNeedsCategoryReview, transactionNeedsTaxReview } from '@/lib/utils/transaction-tax-review';

export const CREDIT_CARD_PAYMENT_CATEGORY = 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT';
export const CREDIT_CARD_PAYMENT_AMOUNT = 500;
export const CREDIT_CARD_PAYMENT_DATE = '2025-06-15';

/**
 * The object `createTransactionServer` receives from bank sync for a posted charge.
 * Mirrors lib/plaid/sync-helper.ts lines 30-35. There is no `transaction_kind`.
 * `iso_currency_code` is the currency field bank sync writes on the same call.
 */
export function bankSyncCreditCardPaymentWrite(transId: string) {
  return {
    trans_id: transId,
    date: CREDIT_CARD_PAYMENT_DATE,
    amount: CREDIT_CARD_PAYMENT_AMOUNT,
    merchant_name: 'Card payment',
    category: CREDIT_CARD_PAYMENT_CATEGORY,
    description: 'Credit card payment',
    is_deductible: null as null,
    analyzed: false,
    analysis_status: 'pending' as const,
    analysisStatus: 'pending' as const,
    pending: false,
    iso_currency_code: 'USD',
  };
}

/** Confirmed-only 2025 Schedule C plus the existing review list, for one saved record. */
export function expectCreditCardPaymentOnReviewWithNoScheduleCLine(record: ScheduleCTransactionLike) {
  expect(record.is_deductible).toBe(true);
  expect(record.review_status).toBe('confirmed');
  expect(record.tax_review_required).toBe(false);
  expect(record.transaction_kind).toBeUndefined();
  expect(record.category).toBe(CREDIT_CARD_PAYMENT_CATEGORY);
  expect(record.date).toBe(CREDIT_CARD_PAYMENT_DATE);
  expect(record.amount).toBe(CREDIT_CARD_PAYMENT_AMOUNT);
  expect(record.pending).toBe(false);
  const schedule = aggregateScheduleC([record], '2025', categoryMapForTaxYear(2025), { mode: 'confirmed-only' });
  const lines = schedule.lineItemsArray.map(item => ({ line: item.lineCode, name: item.lineName, deductible: item.deductible }));
  expect(lines).toEqual([]);
  expect(schedule.totalDeductible).toBe(0);
  expect(schedule.totalExpenses).toBe(0);
  expect(schedule.lineItems['27a']).toBeUndefined();
  expect(schedule.lineItems['27b']).toBeUndefined();
  const reviewList = prioritizeTransactionReview([record].filter(transactionNeedsCategoryReview));
  expect(reviewList).toEqual([record]);
  expect(reviewList[0]?.amount).toBe(CREDIT_CARD_PAYMENT_AMOUNT);
  expect(formatRecordedTransactionAmount(record)).toBe('$500.00');
  expect(transactionNeedsTaxReview(record)).toBe(true);
  expect(dashboardRecordStatus(record)).toBe('review');
}
