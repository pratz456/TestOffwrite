# Plaid OAuth return and repair validation

## Configuration

Register these exact callback URLs on the current Plaid team under Developers → API → Allowed redirect URIs:

- Production: `https://writeoffapp.com/plaid/oauth`
- Staging: `https://writeoff-production-testing.web.app/plaid/oauth`

The registration was saved and verified in the Dashboard on September 17, 2026 UTC. Set server-only `PLAID_REDIRECT_URI` to the corresponding URL before deployment. `getPlaidOAuthRedirectUri` rejects conflicting app/Firebase/provider environments, other origins, alternate paths, credentials, queries, and fragments. With no configured URI, the previous popup flow remains available; production preflight requires the production callback.

The default US/en Link customization now describes financial management and business accounting/tax preparation. The server uses the default customization because it does not override `link_customization_name`.

## Implemented behavior

Before opening Link, the browser stores only the public Link token, signed-in user ID, original callback, optional update Item, and return context in **sessionStorage**. The session expires after 30 minutes and is bound to the same tab, origin, and user. Bank access tokens remain encrypted on the server.

The callback checks the saved session and Plaid state parameter, then reopens the **same Link token** with `receivedRedirectUri`. It does not request another token. New connections exchange the successful public token; repairs sync the original Item without exchanging another public token. Success, cancellation, and leaving the flow clear the stored session. Missing, expired, or mismatched sessions show a safe restart path. Switching users never exposes the previous user's Link token.

Signed `ITEM/ERROR` events with `ITEM_LOGIN_REQUIRED` flag only the current provider's existing Item. The bank list offers in-place repair. Old-provider connections still require a new connection. Before clearing the repair flag, sync verifies the exact Item with Plaid and requires `error === null`; cached transaction data alone does not clear it.

## Evidence already obtained

- 130 focused tests passed across nine Plaid configuration, callback, UI, connection, signature, webhook, and sync files.
- TypeScript `--noEmit --incremental false` passed.
- Independent P0/P1 review found no high-priority issue.
- Hosted staging, non-OAuth Sandbox: initial bank connection imported exactly three synthetic records; all three automatic OpenAI analyses completed; real signed transaction webhook and incremental deduplication passed.
- Authentic Plaid update UI repaired that same bank after a provider-induced login error. A fresh provider read at **2026-09-17 04:28:55 UTC** confirmed a healthy login. Its encrypted token, two saved accounts, three transactions, and user confirmations were preserved.

## Bounded browser OAuth check after this release

This check is **pending**, not a recorded pass.

1. Use the existing synthetic staging account and confirm the deployed API returns the registered staging callback.
2. Start a normal connection and select Plaid's documented Sandbox OAuth institution **Platypus OAuth Bank (`ins_127287`)**.
3. Use an embedded-browser/WebView flow so the browser exercises the redirect path. Ordinary desktop/mobile browser OAuth normally uses a popup. Plaid documents a WebView user-agent example in its OAuth guide; use a browser's supported device emulation if available.
4. Observe return to `/plaid/oauth?oauth_state_id=…` and same-token Link resumption. If the available browser surface only exercises a popup, record that limit explicitly rather than claiming redirect validation.
5. **Decline or exit before Link `SUCCESS`.** Confirm session cleanup/recovery and no exchange request, new bank record, imported transaction, or additional AI job.

Do not claim that this bounded check validates a successful OAuth bank import, all browsers, native banking-app handoff, or production institution approval. Unit tests cover successful create/update callback handling; authentic successful OAuth completion remains a separate test.

A custom OAuth Sandbox account is not a dependable way to enforce the three-transaction spending cap: Plaid warns that OAuth flows can override custom fields with defaults. This run therefore does not create another custom OAuth fixture or accept a potentially larger synthetic import.

## Official references

- [Plaid OAuth guide](https://plaid.com/docs/link/oauth/): registered callback, original-token resumption, testing institution, and WebView redirect testing.
- [Custom Sandbox users](https://plaid.com/docs/sandbox/user-custom/): limitations at OAuth institutions.
- [Data Transparency Messaging](https://plaid.com/docs/link/data-transparency-messaging-migration-guide/): customization use cases.
- [Item webhooks](https://plaid.com/docs/api/items/#error): canonical Item error notification.
