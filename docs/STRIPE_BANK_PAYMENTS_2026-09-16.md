# Stripe bank subscription payments

## Dashboard

ACH Direct Debit was enabled in WriteOff's live Stripe payment-method settings
on September 16, 2026. The dashboard showed Enabled and the confirmation toast.
This alone does not change the app's explicitly card-only Checkout requests.

## Staging application change

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
- Deployed to `writeoff-production-testing.web.app` in commit `e06d2eb`.
  The combined suite passed 2,284 tests; all 11 security-rule tests passed separately.
- Real Stripe test-mode ACH lifecycle events verified settlement and webhook
  persistence before authenticated status polling: success produced a paid invoice
  and export HTTP 200; insufficient funds produced `past_due` and export HTTP 403;
  an unsettled debit produced `payment_pending` and export HTTP 403 even while
  Stripe's subscription status remained `active`.
- Browser inspection confirmed Sandbox Checkout displays Card and US bank account,
  bank search, manual-entry option, and ACH authorization terms. The browser did not
  submit a bank payment; lifecycle tests used Stripe's documented test bank details
  via its API, including microdeposit verification.
- All three synthetic ACH subscriptions were canceled and unused Checkouts expired.
  Evidence: `/tmp/writeoff-ach-e2e-results.json`. No real customer was charged.
- The restricted production key passed read-only expanded-invoice subscription
  retrieval/listing checks. The production application has not been deployed.
- Webhook destinations must include `checkout.session.completed`,
  `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`,
  subscription created/updated/deleted, `invoice.paid`, `invoice.payment_succeeded`,
  `invoice.payment_failed`, `invoice.voided`, and `invoice.marked_uncollectible`.
  The staging test destination has all these events enabled. Production webhook
  configuration remains part of a future production rollout.

References: [Stripe ACH](https://docs.stripe.com/payments/ach-direct-debit),
[Stripe transaction history](https://docs.stripe.com/financial-connections/transactions),
[Plaid Transactions](https://plaid.com/docs/transactions/).
