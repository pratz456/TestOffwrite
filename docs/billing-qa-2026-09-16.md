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
- Monthly cancellation at period end preserved paid access; reactivation
  restored renewal; immediate test cancellation relocked reports/exports.
  The signed deletion webhook was recorded and the expired trial did not restart.

## Remaining verification

Cancellation/reactivation and the distinct Basic tier are
being tested before this report is finalized. Production rollout is separate.
Plaid Sandbox linking remains untested because Sandbox access is unavailable.
