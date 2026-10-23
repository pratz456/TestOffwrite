import { describe, expect, it } from 'vitest';
import { taxDecisionUpdate } from '@/lib/transactions/tax-decision';
import {
  bankSyncCreditCardPaymentWrite,
  expectCreditCardPaymentOnReviewWithNoScheduleCLine,
} from './loan-payment-confirm-path';

describe('confirmed credit card payment without the emulator', () => {
  it('a posted 2025 LOAN_PAYMENTS_CREDIT_CARD_PAYMENT confirmed as a business deduction adds $0 to every Schedule C line and stays on the review list', () => {
    const seeded = {
      ...bankSyncCreditCardPaymentWrite('bank-cc-payment'),
      userId: 'owner',
      user_id: 'owner',
      account_id: 'checking',
    };
    expect(seeded.is_deductible).toBeNull();
    expect(seeded).not.toHaveProperty('transaction_kind');
    const updates = { is_deductible: true as const };
    // Same stamp saveTransactionChanges writes from taxDecisionUpdate. Reverting
    // AWAITING_SCHEDULE_C_LINE fails the line assertion: this record then adds 500
    // on the 2025 other-expenses line.
    const saved = { ...seeded, ...updates, ...taxDecisionUpdate(seeded, updates) };
    expect(saved.review_status).toBe('confirmed');
    expectCreditCardPaymentOnReviewWithNoScheduleCLine(saved);
  });
});
