# Historical Transactions Feature Implementation

## Overview
This feature implements a subscription-based system for accessing extended historical transaction data (3-12 months) through Plaid, gated behind a 1-month free trial and Stripe subscription.

## What Was Implemented

### 1. Plaid Transaction Limiting (3 months default)
- **Modified**: `app/api/plaid/exchange-public-token/route.ts`
  - Default transaction fetch is now 3 months (90 days) for standard users
  - Checks user's historical access entitlement before fetching
  - Historical access users get up to 1 year (365 days)

- **Modified**: `lib/plaid/sync-helper.ts`
  - Updated to respect historical access limits
  - Defaults to 3 months for standard users

### 2. Historical Access Management
- **Created**: `lib/subscriptions/historical-access.ts`
  - `checkHistoricalAccess()` - Checks if user has active trial or subscription
  - `getTransactionDateRange()` - Returns appropriate date range based on access level

### 3. Stripe Integration
- **Created**: `app/api/stripe/create-checkout/route.ts`
  - Creates Stripe Checkout Session with 1-month free trial
  - Creates Stripe customer if doesn't exist
  - Returns checkout URL

- **Created**: `app/api/stripe/webhook/route.ts`
  - Handles Stripe webhook events:
    - `checkout.session.completed` - Activates trial
    - `customer.subscription.created/updated` - Updates subscription status
    - `customer.subscription.deleted` - Revokes access
    - `invoice.payment_succeeded` - Confirms payment
  - Updates user profile with subscription status

- **Created**: `app/stripe/success/page.tsx`
  - Success page shown after successful checkout
  - Confirms trial activation

- **Created**: `app/stripe/cancel/page.tsx`
  - Cancel page shown when user cancels checkout
  - Explains they still have 3 months access

### 4. User Profile Model Updates
- **Modified**: `lib/firebase/profiles.ts` and `lib/firebase/profiles-server.ts`
  - Added subscription fields:
    - `hasHistoricalAccess` (boolean)
    - `trialStart` (Date)
    - `trialEnd` (Date)
    - `subscriptionEnd` (Date)
    - `stripeCustomerId` (string)
    - `stripeSubscriptionId` (string)
    - `stripeSubscriptionStatus` (string)

### 5. UI Components
- **Created**: `components/historical-access-upgrade-card.tsx`
  - Upgrade card shown on transactions page
  - Shows current access status or upgrade option
  - Handles checkout flow

- **Created**: `components/historical-access-notification.tsx`
  - Notification banner for dashboard/home page
  - Shows trial status, expiration warnings, and access ended messages

- **Created**: `components/ui/alert.tsx`
  - Alert component for notifications (shadcn/ui style)

### 6. API Routes
- **Created**: `app/api/subscriptions/check-access/route.ts`
  - GET endpoint to check user's historical access status

## Environment Variables Required

Add these to your `.env.local` and production environment:

```env
# Stripe Configuration
STRIPE_SECRET_KEY=sk_test_... # Your Stripe secret key
STRIPE_WEBHOOK_SECRET=whsec_... # Webhook signing secret from Stripe Dashboard
STRIPE_PRICE_ID=price_... # Price ID for Historical Transactions subscription
NEXT_PUBLIC_STRIPE_PRICE_ID=price_... # Same price ID (for client-side if needed)

# Site URL (for redirects)
NEXT_PUBLIC_SITE_URL=https://writeoffapp.com # Your production URL
```

## Stripe Setup Instructions

1. **Create a Product in Stripe Dashboard**:
   - Go to Stripe Dashboard → Products
   - Create a new product: "Historical Transactions (up to 1 year)"
   - Set up a recurring price (monthly subscription)
   - Copy the Price ID (starts with `price_`)

2. **Set up Webhook**:
   - Go to Stripe Dashboard → Developers → Webhooks
   - Add endpoint: `https://your-domain.com/api/stripe/webhook`
   - Select events to listen for:
     - `checkout.session.completed`
     - `customer.subscription.created`
     - `customer.subscription.updated`
     - `customer.subscription.deleted`
     - `invoice.payment_succeeded`
     - `invoice.payment_failed`
   - Copy the webhook signing secret (starts with `whsec_`)

3. **Configure Trial Period**:
   - The code automatically sets a 30-day trial period
   - Ensure your Stripe product/price allows trials

## Installation

Install the Stripe package:

```bash
npm install stripe
```

## How It Works

1. **Initial Setup**: Users connect bank via Plaid and get 3 months of transactions by default

2. **Upgrade Flow**:
   - User sees upgrade card on transactions page
   - Clicks "Start 1-Month Trial"
   - Redirected to Stripe Checkout
   - Completes checkout (no charge during trial)
   - Webhook activates trial in user profile

3. **During Trial**:
   - User has access to 1 year of historical transactions
   - Dashboard shows notification with days remaining
   - Transactions page shows active trial status

4. **After Trial**:
   - If payment succeeds: Subscription continues, access maintained
   - If payment fails: Access revoked, user back to 3 months
   - Dashboard shows appropriate notifications

5. **Transaction Fetching**:
   - System checks `hasHistoricalAccess` before fetching
   - Standard users: 90 days max
   - Historical access users: 365 days max

## Testing

1. **Test Checkout Flow**:
   - Use Stripe test mode
   - Use test card: `4242 4242 4242 4242`
   - Verify webhook receives events

2. **Test Access Control**:
   - Connect bank as standard user (should get 3 months)
   - Upgrade to trial (should get 1 year)
   - Verify transactions are limited correctly

3. **Test Notifications**:
   - Check dashboard for trial notifications
   - Verify upgrade card shows correct status

## Notes

- All UI components respect the existing dark mode theme system
- The feature is non-intrusive and doesn't modify unrelated functionality
- Transaction fetching gracefully falls back to 3 months if access check fails
- Webhook handles edge cases (missing metadata, customer lookup, etc.)

