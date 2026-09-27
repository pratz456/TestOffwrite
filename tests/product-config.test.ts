import { describe, expect, it } from 'vitest';
import {
  PREMIUM_MONTHLY_PRICE,
  PREMIUM_PRICING,
  PREMIUM_YEARLY_PRICE,
  PRODUCT_ACCESS,
} from '@/lib/subscriptions/product-config';

describe('public product configuration', () => {
  it('keeps trial, history and displayed Premium prices in one client-safe source', () => {
    expect(PRODUCT_ACCESS).toMatchObject({ trialDays: 30, freeHistoryDays: 90, extendedHistoryDays: 730 });
    expect(PREMIUM_PRICING).toEqual({ currency: 'USD', monthlyCents: 1499, yearlyCents: 14999 });
    expect([PREMIUM_MONTHLY_PRICE, PREMIUM_YEARLY_PRICE]).toEqual(['14.99', '149.99']);
  });
});
