/** Public, non-secret product terms. Keep Stripe Dashboard amounts in sync here. */
export const PRODUCT_ACCESS = Object.freeze({
  trialDays: 30,
  freeHistoryDays: 90,
  extendedHistoryDays: 730,
  extendedHistoryLabel: 'up to 24 months (depending on your bank)',
  extendedHistoryTitle: 'Up to 24 months (depending on your bank)',
});

export const PREMIUM_PRICING = Object.freeze({
  currency: 'USD',
  monthlyCents: 1499,
  yearlyCents: 14999,
});

export function usdFromCents(cents: number) {
  return (cents / 100).toFixed(2);
}

export const PREMIUM_MONTHLY_PRICE = usdFromCents(PREMIUM_PRICING.monthlyCents);
export const PREMIUM_YEARLY_PRICE = usdFromCents(PREMIUM_PRICING.yearlyCents);
