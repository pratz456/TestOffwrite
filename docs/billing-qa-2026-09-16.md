# Billing verification — September 16, 2026

## Environment

Tests use Firebase `writeoff-production-testing`, Stripe test mode, and fresh
synthetic users with already-expired trials. No live customer, subscription,
price, or payment method was changed. Secrets and session URLs are kept outside
the repository.

## Approved plan policy

| Plan | Extended history | Reports | Exports |
| --- | --- | --- | --- |
| Free / expired | No | No | No |
| Active trial | Yes | Yes | Yes |
| Legacy Basic ($7.99/month) | Yes | No | No |
| Premium | Yes | Yes | Yes |

Existing Basic subscriptions retain their current Stripe price. They are
recognized by configured Basic price IDs, including duplicate-checkout
protection. Paid tiers are verified server-side and cannot be edited by clients.
An active subscription scheduled to cancel retains its features through the
paid period; terminal/payment-required states revoke access. A cancellation does
not restart an expired trial.

## Observed staging checks

- Before purchase: report and CSV export routes returned HTTP 403.
- Declined monthly Checkout: Stripe displayed the card-declined error; the
  Checkout remained unpaid and report/export routes remained HTTP 403.
- Successful monthly and annual Checkouts: Stripe returned paid, complete test sessions;
  the app displayed “Premium is active”; report/export routes returned HTTP 200.
- Signed webhook receipts were recorded for both plans (`checkout.session.completed`
  for monthly, `customer.subscription.created` for annual), and Firebase
  subscription state matched Stripe.
- The app opened the test customer portal with the correct subscription, test
  card, and paid invoice. Its return link led back to staging billing settings.
- A second checkout for either subscribed account was rejected with HTTP 409
  `SUBSCRIPTION_EXISTS`.
- Monthly and annual cancellation at period end preserved paid access; reactivation
  restored renewal; immediate test cancellation relocked reports/exports.
  The signed deletion webhook was recorded and the expired trial did not restart.
- Deployed Firestore rules rejected a direct authenticated synthetic-user attempt
  to overwrite `subscriptionPlan` with HTTP 403 `PERMISSION_DENIED`.
- Basic's signed webhook produced the distinct `basic` plan, a 730-day import
  window, report/export HTTP 403, and duplicate-checkout HTTP 409. Its dashboard
  displayed Basic, the actual $7.99/month price, and history-only benefits.
- Basic cancellation/reactivation preserved the correct benefits; immediate
  cancellation restored the 90-day import window without restarting a trial.
- ACH success, failure, and pending settlement gates passed; see
  [bank payment verification](STRIPE_BANK_PAYMENTS_2026-09-16.md).

## Build validation

The final Basic, bank-payment, and billing-navigation implementation passed 2,301 unit, route,
and component tests. All 11 opt-in Firestore/Storage security tests passed in a
separate emulator instance. TypeScript validation and the production build passed.

## Remaining verification

The deployed Basic report gate showed “Manage billing” and opened the expanded
Subscription section with Basic, $7.99/month, and history-only benefits. The repeat
test subscription was canceled after verification. Production rollout is separate.
Plaid Sandbox access is now available; bank-link and import verification is in progress.
