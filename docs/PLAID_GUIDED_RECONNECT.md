# Guided legacy-bank reconnect

## Owner flow

An owner blocked by `BANK_HISTORY_REVIEW_REQUIRED` can open `/plaid/reconnect`.

1. Start or resume an owner-bound review. OAuth retains its session ID in the existing short-lived tab session.
2. Link a replacement Item. The private connection is `pending_history_review` and its imports go only to `user_profiles/{uid}/bank_reconnects/{sessionId}/import_records`.
3. Map every returned bank account to saved account history, or explicitly mark it different. Mapping freezes before any decisions.
4. Review records as duplicate, distinct, or deferred. Exact date/amount/merchant/currency matches are suggestions. Different details require an additional acknowledgment.
5. Activate after Plaid reports `HISTORICAL_UPDATE_COMPLETE`, every account is mapped, no record is pending, and any deferred records are acknowledged.

Reviewed duplicates get their `superseded_by` reference atomically on their first write to a transaction collection. The earlier record remains canonical and is never edited by this flow. Distinct records are unconfirmed and follow the normal AI/review process. Deferred imports remain private. Pending corrections retain the prior saved record until reviewed.

## Continued sync and safety

- The connection permanently retains its review session and historical date boundary.
- New posted purchases after that boundary flow into normal unconfirmed transactions after a transactional check for possible overlaps in mapped saved history.
- Historical backfills, ambiguous post-boundary records, and changes to existing replacement records return to private review. Full backfill also uses this boundary when a plan's history access expands.
- Previously linked duplicates cannot overwrite their canonical legacy record. Owners can keep the saved record or reaffirm its duplicate relationship. Corrections to distinct replacement records require a fresh version of that record and become unconfirmed again when accepted.
- Prior reconnect sessions remain selectable as canonical saved history during later reconnects. A completed first-bank review does not prevent starting another bank.
- Review/import/activation/disconnection share an Item lease. Every decision rechecks provider and canonical versions in a Firestore transaction. Decision batches contain at most 25 rows; retries resume earlier committed decisions without a partially countable duplicate.
- Pending Items can use Link update mode for login repair and can be revoked before account deletion. Individual disconnect cancels its corresponding review while retaining saved transaction history.
- Owner archives and audit-support packets include unresolved-history counts separately. Private imports never use a collection named `transactions` and never enter tax aggregates.

## Operational boundaries

No provider configuration, customer data, production deployment, or automatic historical merge is part of this change. Provider exchange retains the existing private durable recovery ledger for uncertain exchange/revocation outcomes. Session and import documents never contain access tokens.

All changed existing replacement transactions currently require explicit correction review, including clean post-cutover records. This is conservative: unchanged new posted transactions retain the normal automatic import path. Deferred history remains visible as incomplete until reviewed.

## Validation

Focused tests cover ownership and spoofed accounts, first-write duplicate exclusion, stale provider/canonical/promoted versions, interrupted/replayed decisions, Item lease contention and activation, multiple reconnects, post-cutover ambiguity, late and out-of-window corrections, full backfill, OAuth resume, pending Item revocation/deletion, archive exclusion and authenticated routes.

The provider history-completion condition follows the Plaid Transactions API `transactions_update_status` contract: https://plaid.com/docs/api/products/transactions/.
