# TaxBandits Provider Contract (Integration Notes)

This document is a living contract between **WriteOff** and **TaxBandits** for the external filing flow.

## 1. What this integration does
- WriteOff prepares and validates a **Schedule C-style summary** (and any required metadata).
- WriteOff sends the user to **TaxBandits** to complete filing workflows externally.
- WriteOff does **not** embed filing inside the WriteOff app.

## 2. Session / redirect contract (TODO: fill from TaxBandits docs)

### 2.1. How we start a filing session
- API method: `POST` / `GET` / SDK call:
- Endpoint path:
- Auth method:
  - Header(s):
  - API keys / OAuth / other:

### 2.2. Request payload shape
- Required fields:
  - `taxYear`:
  - `userIdentifier` (WriteOff user id / email / etc.):
  - `scheduleC summary` fields:
  - `business identity` fields:
  - W-9 / TIN-related fields (if needed):

### 2.3. Response shape
- Response includes:
  - `redirectUrl` (absolute URL):
  - `sessionId` / `externalRef` (opaque string):

### 2.4. Redirect expectations
- Redirect URL format:
- How to pass session reference (query param, path param, token):

## 3. Status callbacks (if supported)

### 3.1. Webhook endpoint
- Endpoint URL in WriteOff:
- Webhook authentication:
- Payload fields:
  - `sessionId`:
  - `status` enum mapping:
  - `timestamp`:

### 3.2. Status storage
- WriteOff stores canonical status in Firestore:
  - collection:
  - document key:

## 4. Privacy / compliance
- What data we send pre-redirect:
  - Keep: only what’s necessary to start the flow and prefill (if supported).
  - Never imply: “taxes are filed inside WriteOff”.
- What PII is included:
- Data retention expectations:

## 5. Provider-specific “DO/DON’T” wording rules (for UI copy)
- ✅ Must say the user is leaving WriteOff and being redirected to TaxBandits.
- ❌ Must not claim the return was submitted through IRS unless TaxBandits status is explicitly confirmed and shown.

---

## Open questions
- Which TaxBandits endpoint should WriteOff call to create a session/redirectUrl?
- What exact fields are needed for W-9 / TIN matching?
- What is the canonical status enum (if webhooks exist)?

