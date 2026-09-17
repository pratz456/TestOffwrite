# Stripe bank subscription payments

## Dashboard

ACH Direct Debit was enabled in WriteOff's live Stripe payment-method settings
on September 16, 2026. The dashboard showed Enabled and the confirmation toast.
This alone does not change the app's explicitly card-only Checkout requests.

## Prepared app change

- New subscription Checkouts accept cards and US bank accounts. Stripe hosts bank
  verification and mandate collection. Only payment-method permission is requested.
- New subscriptions carry `payment_policy=settled_invoice`. Reconciliation expands
  the latest invoice and withholds paid access until its status is `paid`, even if
  Stripe already reports an active subscription. Pending or failed renewals also
  withhold paid features; prior saved transactions remain governed by existing policy.
- Existing subscriptions retain their existing status-based access policy.
- Async checkout failure/success, invoice payment, voiding, and uncollectible events
  reconcile current Stripe state. The success page explains bank settlement time.
- Plaid remains the data provider. Existing trial/paid history requests remain 730
  days; free requests remain 90. Neither provider guarantees a minimum history at
  every bank. Stripe Financial Connections cannot provide the required 730-day pull.

## Validation and rollout

- 166 focused subscription, route, success-page, client, and Plaid tests passed.
- ESLint passed for the six modified implementation/test files.
- Stripe's test API accepted a subscription Checkout with both `card` and
  `us_bank_account`, and payment-method-only Financial Connections permissions.
  The unpaid test session was expired afterward. No customer was charged.
- A full ACH checkout, settlement/failure lifecycle, and deployment remain to be
  verified in the target environment. This change is currently local to staging.
- Webhook destinations must include `checkout.session.completed`,
  `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`,
  subscription created/updated/deleted, `invoice.paid`, `invoice.payment_succeeded`,
  `invoice.payment_failed`, `invoice.voided`, and `invoice.marked_uncollectible`.

References: [Stripe ACH](https://docs.stripe.com/payments/ach-direct-debit),
[Stripe transaction history](https://docs.stripe.com/financial-connections/transactions),
[Plaid Transactions](https://plaid.com/docs/transactions/).
