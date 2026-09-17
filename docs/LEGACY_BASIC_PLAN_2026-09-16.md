# Legacy Basic plan preservation

The approved policy preserves existing Basic subscriptions as a distinct paid plan. This change does not create, cancel, reprice, or upgrade any customer subscription. It has not been rolled out to production.

| Verified active plan | Extended bank history | Reports | Exports |
| --- | --- | --- | --- |
| Basic | Yes, up to the existing 730-day bank limit | No | No |
| Premium | Yes | Yes | Yes |
| Trial | Yes | Yes | Yes |
| Free, expired, or payment-required | No; new imports use the 90-day limit | No | No |

Already saved records remain accessible. History availability still depends on the connected bank. A subscription scheduled to cancel retains its plan features until the verified period ends. Immediate cancellation, expiry, or payment-required status closes those features.

## Billing and migration

- The server recognizes `STRIPE_PRICE_ID_BASIC_MONTHLY`, `STRIPE_PRICE_ID_BASIC_YEARLY`, and legacy `STRIPE_PRICE_ID_BASIC`, plus their `NEXT_PUBLIC_` aliases. Existing Premium aliases are unchanged.
- Stripe reconciliation writes a server-owned `subscriptionPlan` of `basic` or `premium`. An old paid profile without this verified tier remains locked until the existing subscription-status check refreshes it from Stripe. The server does not infer Premium from paid status alone.
- Basic remains a recognized subscription for duplicate-checkout protection. Its billing UI displays the actual provider amount and directs users to manage the existing subscription. The app's new-subscription checkout continues to sell Premium only.
- Deploy the Firestore rules protection for `subscriptionPlan` with the application change. Client profile creation, updates, field deletion, and the profile API cannot choose or replace this tier.
- Staging Basic lifecycle verification passed: active and scheduled-cancellation
  history access, report/export403, duplicate409, reactivation, and access removal
  after cancellation. The expired trial did not restart. Production rollout remains separate.

## Validation

- Full unit/route/component suite: 2,269 passed; 11 opt-in emulator tests skipped in that run.
- Those 11 Firestore/Storage tests passed separately against `demo-writeoff-basic-policy` on dedicated local ports 8181/9297. The existing local preview database was untouched.
- Coverage includes Basic active and scheduled-cancellation access, exact expiry, payment failures, rejected Premium exports, allowed history imports, legacy alias recognition, unknown-tier denial, recovery from an earlier `unsupported_product` record, duplicate checkout prevention, unchanged provider pricing, and client tier-escalation denial.

Dedicated emulator logs: `/tmp/writeoff-basic-rules-emulator.log`. Full suite log: `/tmp/writeoff-basic-full-suite.log`.
