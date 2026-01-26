# Pricing Update Summary: Monthly & Yearly Plans

## What Changed

The Historical Transactions feature now supports **two pricing options**:

- **Monthly**: $14.99/month
- **Yearly**: $150/year (Save ~17% vs monthly)

## Implementation Details

### 1. API Route Updates
- **File**: `app/api/stripe/create-checkout/route.ts`
- **Change**: Now accepts `interval` parameter ('monthly' or 'yearly')
- **Environment Variables**:
  - `STRIPE_PRICE_ID_MONTHLY` - Monthly price ID
  - `STRIPE_PRICE_ID_YEARLY` - Yearly price ID
  - Falls back to legacy `STRIPE_PRICE_ID` for monthly if new vars not set

### 2. UI Component Updates
- **File**: `components/historical-access-upgrade-card.tsx`
- **Changes**:
  - Added billing interval selector (tabs: Monthly/Yearly)
  - Dynamic pricing display ($14.99/month or $150/year)
  - Shows savings badge on yearly option (17% savings)
  - Calculates and displays yearly savings amount

### 3. Environment Variables
Updated to require both price IDs:
- `STRIPE_PRICE_ID_MONTHLY` / `NEXT_PUBLIC_STRIPE_PRICE_ID_MONTHLY`
- `STRIPE_PRICE_ID_YEARLY` / `NEXT_PUBLIC_STRIPE_PRICE_ID_YEARLY`

### 4. Documentation Updates
- Updated `STRIPE_SETUP_GUIDE.md` with instructions for creating both prices
- Updated `QUICK_START_STRIPE.md` with new pricing structure
- Updated `.env.example` with both price ID variables
- Updated validation script to check for both price IDs

## User Experience

Users will see:
1. **Billing Interval Tabs**: Switch between Monthly and Yearly
2. **Dynamic Pricing**: Shows $14.99/month or $150/year based on selection
3. **Savings Indicator**: Yearly tab shows "Save 17%" badge
4. **Savings Message**: "Save $29.88 per year vs monthly" when yearly is selected

## Stripe Setup Required

In Stripe Dashboard, create:
1. **One Product**: "Historical Transactions (up to 1 year)"
2. **Two Prices**:
   - Monthly: $14.99/month (recurring)
   - Yearly: $150/year (recurring)

Both prices will have the same 30-day free trial.

## Testing

1. Test monthly checkout flow
2. Test yearly checkout flow
3. Verify both create subscriptions correctly
4. Verify webhook handles both subscription types
5. Verify pricing display updates correctly when switching tabs

## Backward Compatibility

- Code still supports legacy `STRIPE_PRICE_ID` for monthly (falls back if new vars not set)
- Existing monthly subscriptions will continue to work
- New subscriptions can choose monthly or yearly

