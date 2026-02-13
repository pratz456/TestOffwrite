# Firestore Schema Changes for Historical Transactions Feature

## Overview
This document outlines all Firestore schema changes made to support the historical transactions subscription feature with Stripe integration.

## Collection: `user_profiles`

### New Fields Added

The following fields have been added to the `user_profiles` collection to support subscription management:

#### Subscription Status Fields

1. **`hasHistoricalAccess`** (boolean)
   - **Purpose**: Indicates whether the user has access to 1-year historical transactions
   - **Default**: `false`
   - **Set to `true` when**: User has an active subscription (status: `active` or `trialing`)
   - **Set to `false` when**: Subscription is cancelled or expired
   - **Updated by**: Stripe webhook (`customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`)

2. **`stripeCustomerId`** (string)
   - **Purpose**: Stripe Customer ID for the user
   - **Format**: `cus_xxxxxxxxxxxxx`
   - **Created**: When user first subscribes via Stripe Checkout
   - **Updated by**: Stripe webhook or `/api/stripe/create-checkout`

3. **`stripeSubscriptionId`** (string)
   - **Purpose**: Stripe Subscription ID
   - **Format**: `sub_xxxxxxxxxxxxx`
   - **Created**: When subscription is created via Stripe Checkout
   - **Updated by**: Stripe webhook

4. **`stripeSubscriptionStatus`** (string)
   - **Purpose**: Current status of the Stripe subscription
   - **Possible Values**:
     - `trialing` - User is in free trial period
     - `active` - Subscription is active and paid
     - `canceled` - Subscription has been cancelled
     - `past_due` - Payment failed
     - `unpaid` - Payment required
   - **Updated by**: Stripe webhook

#### Date Fields

5. **`trialStart`** (Timestamp)
   - **Purpose**: When the free trial period started
   - **Format**: Firestore Timestamp
   - **Set when**: Subscription enters trial period
   - **Updated by**: Stripe webhook (from `subscription.trial_start`)

6. **`trialEnd`** (Timestamp)
   - **Purpose**: When the free trial period ends
   - **Format**: Firestore Timestamp
   - **Set when**: Subscription enters trial period
   - **Updated by**: Stripe webhook (from `subscription.trial_end`)

7. **`subscriptionEnd`** (Timestamp)
   - **Purpose**: When the current subscription period ends
   - **Format**: Firestore Timestamp
   - **Set when**: Subscription is created or renewed
   - **Updated by**: Stripe webhook (from `subscription.current_period_end`)

## Security Rules

### Updated Rules

The Firestore security rules have been updated to protect subscription-related fields from client-side modifications. These fields can only be updated by the Admin SDK (server-side).

**Protected Fields:**
- `hasHistoricalAccess`
- `trialStart`
- `trialEnd`
- `subscriptionEnd`
- `stripeCustomerId`
- `stripeSubscriptionId`
- `stripeSubscriptionStatus`

### Rule Implementation

```javascript
// In firestore.rules
match /user_profiles/{uid} {
  allow update: if request.auth != null
    && request.auth.uid == uid
    && !request.resource.data.diff(resource.data).affectedKeys().hasAny([
      'hasHistoricalAccess',
      'trialStart',
      'trialEnd',
      'subscriptionEnd',
      'stripeCustomerId',
      'stripeSubscriptionId',
      'stripeSubscriptionStatus'
    ]);
}
```

## Data Flow

### Subscription Creation Flow

1. User clicks "Start 1-Month Trial" on subscription page
2. Frontend calls `/api/stripe/create-checkout`
3. Stripe Checkout Session created with 30-day trial
4. User completes payment in Stripe
5. Stripe webhook `checkout.session.completed` fires
6. Webhook handler calls `handleCheckoutCompleted()`
7. Webhook handler calls `handleSubscriptionUpdate()`
8. Firestore `user_profiles/{uid}` updated with:
   - `stripeCustomerId`
   - `stripeSubscriptionId`
   - `stripeSubscriptionStatus: 'trialing'`
   - `hasHistoricalAccess: true`
   - `trialStart` (from Stripe)
   - `trialEnd` (from Stripe)
   - `subscriptionEnd` (from Stripe)

### Subscription Update Flow

1. Stripe subscription status changes (e.g., trial ends, payment succeeds)
2. Stripe webhook `customer.subscription.updated` fires
3. Webhook handler calls `handleSubscriptionUpdate()`
4. Firestore `user_profiles/{uid}` updated with new status and dates

### Subscription Cancellation Flow

1. User cancels subscription (via UI or Stripe portal)
2. Stripe webhook `customer.subscription.deleted` fires
3. Webhook handler calls `handleSubscriptionDeleted()`
4. Firestore `user_profiles/{uid}` updated with:
   - `hasHistoricalAccess: false`
   - `stripeSubscriptionStatus: 'canceled'`
   - `trialStart: null`
   - `trialEnd: null`

## Migration Guide

### For Existing Users

If you have existing users without subscription data:

1. **No action needed** - They will default to 3 months of transaction history
2. **When they subscribe** - The webhook will automatically populate all fields

### Manual Migration (if needed)

If you need to manually set subscription data for testing or migration:

```javascript
// Using Firebase Admin SDK
const admin = require('firebase-admin');
const db = admin.firestore();

await db.collection('user_profiles').doc('USER_ID').update({
  hasHistoricalAccess: true,
  stripeSubscriptionStatus: 'active',
  stripeCustomerId: 'cus_xxxxx',
  stripeSubscriptionId: 'sub_xxxxx',
  subscriptionEnd: admin.firestore.Timestamp.fromDate(new Date('2025-12-31')),
  // ... other fields
});
```

## API Endpoints

### Check Access Status
- **Endpoint**: `GET /api/subscriptions/check-access`
- **Returns**: Current access status and subscription details

### Verify Stripe Subscription
- **Endpoint**: `POST /api/subscriptions/verify-stripe`
- **Purpose**: Verify subscription exists in Stripe and compare with Firestore
- **Use Case**: Debugging subscription sync issues

### Fix Access
- **Endpoint**: `POST /api/subscriptions/fix-access`
- **Purpose**: Manually sync subscription from Stripe to Firestore
- **Use Case**: If webhook didn't process correctly

## Testing

### Test Subscription Status

1. Check access status:
   ```bash
   curl -X GET http://localhost:3000/api/subscriptions/check-access \
     -H "Authorization: Bearer YOUR_TOKEN"
   ```

2. Verify Stripe subscription:
   ```bash
   curl -X POST http://localhost:3000/api/subscriptions/verify-stripe \
     -H "Authorization: Bearer YOUR_TOKEN"
   ```

3. Fix access if needed:
   ```bash
   curl -X POST http://localhost:3000/api/subscriptions/fix-access \
     -H "Authorization: Bearer YOUR_TOKEN"
   ```

## Important Notes

1. **Webhook Dependency**: Subscription data is primarily updated via Stripe webhooks. Ensure webhooks are properly configured.

2. **Date Handling**: All dates are stored as Firestore Timestamps. When reading, use `.toDate()` to convert to JavaScript Date objects.

3. **Access Logic**: The `hasHistoricalAccess` field determines transaction date range:
   - `true` → 365 days (1 year)
   - `false` → 90 days (3 months)

4. **Trial Period**: During trial (`stripeSubscriptionStatus: 'trialing'`), `hasHistoricalAccess` is `true`. After trial ends, it remains `true` if subscription is active.

5. **Cancellation**: When subscription is cancelled, `hasHistoricalAccess` is set to `false` immediately, but access continues until `subscriptionEnd` date.

## Troubleshooting

### Subscription not showing in Firestore

1. Check Stripe Dashboard → Webhooks → Events
2. Verify webhook endpoint is accessible
3. Check webhook secret is correct
4. Use `/api/subscriptions/verify-stripe` to check Stripe
5. Use `/api/subscriptions/fix-access` to manually sync

### Access not working despite subscription

1. Check `hasHistoricalAccess` field in Firestore
2. Check `stripeSubscriptionStatus` is `active` or `trialing`
3. Verify `subscriptionEnd` is in the future
4. Check server logs for access check results
5. Use debug endpoint: `/api/subscriptions/debug-access`

