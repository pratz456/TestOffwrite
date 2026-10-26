/**
 * Pure checks for scripts/stripe-test-clock-filing-check.mjs.
 * Importing that module must not execute it or contact Stripe.
 */
import { describe, expect, it } from 'vitest';
import {
  assertFilingPrice,
  assertFirstInvoice,
  assertInitialSubscription,
  assertPremiumYearlyPrice,
  assertRenewalInvoice,
  assertTestModeKey,
  publicError,
  readVerificationConfig,
  renewalAdvanceTime,
  resolveFirstInvoiceId,
  selectRenewalInvoice,
  wasScriptInvoked,
} from '../scripts/stripe-test-clock-filing-check.mjs';

const PREMIUM = 'price_premium_fixture';
const FILING = 'price_filing_fixture';
const KEY = 'sk_test_fixture';

const env = {
  STRIPE_TEST_SECRET_KEY: KEY,
  STRIPE_TEST_PREMIUM_YEARLY_PRICE_ID: PREMIUM,
  STRIPE_TEST_FILING_PRICE_ID: FILING,
};

function subscription(items: Array<{ id: string; periodEnd: number }>) {
  return {
    id: 'sub_fixture',
    items: {
      data: items.map((item, index) => ({
        id: `si_${index}`,
        price: { id: item.id },
        current_period_end: item.periodEnd,
      })),
    },
  };
}

function line(priceId: string, amount: number) {
  return {
    id: `il_${priceId}`,
    amount,
    currency: 'usd',
    description: null,
    pricing: {
      type: 'price_details',
      price_details: { price: priceId, product: 'prod_fixture' },
      unit_amount_decimal: String(amount),
    },
  };
}

function invoice(lines: Array<{ id: string; amount: number }>, status: string, extra: Record<string, unknown> = {}) {
  const total = lines.reduce((sum, entry) => sum + entry.amount, 0);
  return {
    id: 'in_fixture',
    status,
    currency: 'usd',
    subtotal: total,
    total,
    amount_due: status === 'paid' ? 0 : total,
    amount_paid: status === 'paid' ? total : 0,
    lines: { data: lines.map(entry => line(entry.id, entry.amount)), has_more: false },
    ...extra,
  };
}

describe('stripe test clock filing check', () => {
  it('does not run the verification script on import', () => {
    expect(wasScriptInvoked()).toBe(false);
  });

  it('accepts a sk_test_ key and refuses sk_live_, rk_live_, and any other key', () => {
    expect(assertTestModeKey(`  ${KEY}  `)).toBe(KEY);
    expect(readVerificationConfig(env, ['--api-only', '--keep'])).toEqual({
      key: KEY, premiumPriceId: PREMIUM, filingPriceId: FILING, apiOnly: true, keep: true,
    });
    for (const [value, pattern] of [
      ['', /missing/],
      ['sk_live_fixture', /sk_live_/],
      ['rk_live_fixture', /rk_live_/],
      ['rk_test_fixture', /sk_test_/],
      ['pk_test_fixture', /sk_test_/],
      ['sk_test', /sk_test_/],
    ] as const) {
      expect(() => assertTestModeKey(value)).toThrow(pattern);
      try {
        assertTestModeKey(value);
      } catch (error) {
        expect(error instanceof Error ? error.message : '').not.toContain('fixture');
      }
    }
    expect(() => readVerificationConfig({ ...env, STRIPE_TEST_SECRET_KEY: 'sk_live_fixture' }, [])).toThrow(/sk_live_/);
    expect(() => readVerificationConfig({ STRIPE_TEST_SECRET_KEY: KEY }, [])).toThrow(/STRIPE_TEST_PREMIUM_YEARLY_PRICE_ID/);
    expect(() => readVerificationConfig({ ...env, STRIPE_TEST_FILING_PRICE_ID: PREMIUM }, [])).toThrow(/different prices/);
    expect(() => readVerificationConfig(env, ['--nope'])).toThrow(/Unknown argument/);
    expect(publicError(new Error(`request used ${KEY}`))).toBe('request used [redacted]');
    expect(publicError(Object.assign(new Error('card declined'), { code: 'card_declined' }))).toBe('card declined (card_declined)');
  });

  it('accepts a test mode recurring yearly Premium price', () => {
    expect(assertPremiumYearlyPrice({
      id: PREMIUM, livemode: false, type: 'recurring', recurring: { interval: 'year', interval_count: 1 },
    }, PREMIUM).id).toBe(PREMIUM);
    expect(() => assertPremiumYearlyPrice({
      id: PREMIUM, livemode: false, type: 'recurring', recurring: { interval: 'month', interval_count: 1 },
    }, PREMIUM)).toThrow(/yearly/);
    expect(() => assertPremiumYearlyPrice({
      id: PREMIUM, livemode: true, type: 'recurring', recurring: { interval: 'year', interval_count: 1 },
    }, PREMIUM)).toThrow(/livemode false/);
    expect(() => assertFilingPrice({ id: FILING, livemode: true, type: 'one_time' }, FILING)).toThrow(/livemode false/);
  });

  it('refuses a filing price that is not one_time', () => {
    expect(assertFilingPrice({ id: FILING, livemode: false, type: 'one_time', recurring: null }, FILING).type).toBe('one_time');
    expect(() => assertFilingPrice({
      id: FILING, livemode: false, type: 'recurring', recurring: { interval: 'year', interval_count: 1 },
    }, FILING)).toThrow(/one_time/);
  });

  it('passes when subscription items contain the Premium price and not the filing price and the paid first invoice has both lines', () => {
    expect(assertInitialSubscription(subscription([{ id: PREMIUM, periodEnd: 1_700_000_000 }]), PREMIUM, FILING)).toEqual([PREMIUM]);
    const report = assertFirstInvoice(invoice([
      { id: PREMIUM, amount: 11111 },
      { id: FILING, amount: 22222 },
    ], 'paid'), PREMIUM, FILING);
    expect(report).toMatchObject({
      status: 'paid',
      currency: 'usd',
      subtotal: 33333,
      total: 33333,
      amount_due: 0,
      amount_paid: 33333,
      lines: [
        { priceId: PREMIUM, amount: 11111 },
        { priceId: FILING, amount: 22222 },
      ],
    });
    expect(() => assertFirstInvoice(invoice([{ id: PREMIUM, amount: 11111 }], 'paid'), PREMIUM, FILING)).toThrow(/filing price/);
    expect(() => assertFirstInvoice(invoice([
      { id: PREMIUM, amount: 11111 },
      { id: FILING, amount: 22222 },
    ], 'open'), PREMIUM, FILING)).toThrow(/expected paid/);
  });

  it('fails when the filing price shows up in subscription items', () => {
    expect(() => assertInitialSubscription(subscription([
      { id: PREMIUM, periodEnd: 1_700_000_000 },
      { id: FILING, periodEnd: 1_700_000_000 },
    ]), PREMIUM, FILING)).toThrow(/subscription items include the filing price/);
  });

  it('passes when the renewal invoice has exactly one Premium line', () => {
    const periodEnd = 1_700_000_000;
    const sub = subscription([
      { id: FILING, periodEnd: 10 },
      { id: PREMIUM, periodEnd },
    ]);
    expect(renewalAdvanceTime(sub, PREMIUM)).toBe(periodEnd + 86400);
    expect(() => renewalAdvanceTime(subscription([{ id: FILING, periodEnd: 10 }]), PREMIUM)).toThrow(/current_period_end/);
    const renewal = selectRenewalInvoice([
      { id: 'in_first', billing_reason: 'subscription_create' },
      { id: 'in_renewal', billing_reason: 'subscription_cycle' },
    ], 'in_first');
    expect(renewal.id).toBe('in_renewal');
    expect(() => selectRenewalInvoice([{ id: 'in_first', billing_reason: 'subscription_create' }], 'in_first')).toThrow(/subscription_cycle/);
    expect(assertRenewalInvoice(invoice([{ id: PREMIUM, amount: 11111 }], 'paid', {
      id: 'in_renewal', billing_reason: 'subscription_cycle',
    }), PREMIUM, FILING)).toMatchObject({
      id: 'in_renewal',
      total: 11111,
      amount_paid: 11111,
      lines: [{ priceId: PREMIUM, amount: 11111 }],
    });
  });

  it('uses session.invoice when that is the only invoice id', () => {
    expect(resolveFirstInvoiceId({ invoice: 'in_session_fixture' }, { latest_invoice: null }))
      .toEqual({ id: 'in_session_fixture', source: 'session.invoice' });
    expect(resolveFirstInvoiceId({ invoice: { id: 'in_session_fixture' } }, {}))
      .toEqual({ id: 'in_session_fixture', source: 'session.invoice' });
  });

  it('uses subscription.latest_invoice when the session invoice field is empty', () => {
    expect(resolveFirstInvoiceId({ invoice: null }, { latest_invoice: 'in_latest_fixture' }))
      .toEqual({ id: 'in_latest_fixture', source: 'subscription.latest_invoice' });
    expect(resolveFirstInvoiceId({ invoice: '' }, { latest_invoice: { id: 'in_latest_fixture' } }))
      .toEqual({ id: 'in_latest_fixture', source: 'subscription.latest_invoice' });
    expect(resolveFirstInvoiceId(null, { latest_invoice: 'in_latest_fixture' }))
      .toEqual({ id: 'in_latest_fixture', source: 'subscription.latest_invoice' });
  });

  it('uses session.invoice when both invoice ids match', () => {
    expect(resolveFirstInvoiceId(
      { invoice: 'in_same_fixture' },
      { latest_invoice: { id: 'in_same_fixture' } },
    )).toEqual({ id: 'in_same_fixture', source: 'session.invoice' });
  });

  it('throws when the session invoice and subscription latest invoice differ', () => {
    expect(() => resolveFirstInvoiceId(
      { invoice: 'in_session_fixture' },
      { latest_invoice: { id: 'in_latest_fixture' } },
    )).toThrow('Checkout Session invoice in_session_fixture does not match subscription latest_invoice in_latest_fixture.');
  });

  it('throws when neither the session invoice nor the subscription latest invoice is set', () => {
    expect(() => resolveFirstInvoiceId({ invoice: null }, { latest_invoice: null }))
      .toThrow('No first invoice was found on session.invoice or subscription.latest_invoice.');
    expect(() => resolveFirstInvoiceId(null, {})).toThrow(/latest_invoice/);
  });

  it('fails when a filing line is on the renewal invoice', () => {
    expect(() => assertRenewalInvoice(invoice([
      { id: PREMIUM, amount: 11111 },
      { id: FILING, amount: 22222 },
    ], 'paid'), PREMIUM, FILING)).toThrow(/renewal invoice includes the filing price/);
    expect(() => assertRenewalInvoice(invoice([{ id: FILING, amount: 22222 }], 'paid'), PREMIUM, FILING)).toThrow(/filing price/);
  });
});
