# WriteOff iOS app — plan and device-signal roadmap

Prepared September 17, 2026. The scaffold lives in `mobile/` (Expo / React Native). It reuses the web API and Firebase Auth; it adds no tax logic of its own and contains no provider secrets.

## Why a native app (and why not a wrapper)

| Option | Verdict |
|---|---|
| Wrap the existing web app (Capacitor / WebView) | Fast, but Apple rejects thin wrappers (Guideline 4.2) and background mileage still needs native plugins. Not recommended as the App Store product. |
| Expo / React Native app calling the existing API | **Chosen.** Native background location, camera, push, Face ID and widgets; one TypeScript codebase; EAS cloud builds so a Mac is not required for CI builds. |
| SwiftUI app | Best platform fidelity, second codebase and team. Revisit if the RN app hits limits. |

## Shipped in the scaffold

- Email sign-in for verified accounts; ID tokens sent as `Authorization: Bearer` (already accepted by every API route).
- Automatic drive detection (background location + motion hints). Drives become **candidates**; the user classifies each one Business (business purpose required, saved via `POST /api/mileage`) or Personal (deleted on device). Trip miles use each trip's date so the year-correct IRS rate applies on the web.
- Receipt capture with server OCR, mandatory human review, and a required real date before saving.
- Pure detection logic in `mobile/src/trips/geometry.ts` is unit-tested from the root suite (`tests/mobile-trip-geometry.test.ts`).

## Device signals worth adding, in priority order

| Signal | Tax value | How it feeds AI analysis | Privacy / review constraint |
|---|---|---|---|
| **Background location + motion activity** (shipped) | Contemporaneous mileage log — the single most audited freelancer deduction | Trip date/distance/purpose; frequent destinations become "regular work locations" that support travel vs. commuting questions | "Always" permission needs clear purpose strings and in-app explanation; store only trip summaries, delete raw points |
| **Calendar (EventKit)** | Business purpose evidence for meals, travel and mileage ("client meeting with Acme, 2pm") | Match a transaction's time/place to a calendar event; propose the event title as the business purpose for the user to confirm | Read-only access; never upload full calendars, only the matched event title/time the user accepts |
| **Camera + on-device Vision OCR** | Faster, offline receipt capture; better line-item extraction than server Tesseract | Merchant/date/amount/line items; detects meal receipts that need attendee facts | Photos stay local until the user saves |
| **Photo library metadata (EXIF)** | Receipt time and place for matching to bank transactions | Auto-suggest the matching transaction; flag mismatched dates | Ask only for selected photos; do not scan the whole library |
| **Push notifications** | Timely review keeps confirmed totals current; quarterly-payment reminders (Apr 15 / Jun 15 / Sep 15 / Jan 15) | Nudge to classify new drives and imported transactions; deadline reminders never state an amount due unless the reviewed estimate exists | Opt-in; no financial figures on lock screen by default |
| **Contacts** | Attendees for meal deductions (who was present) | Autocomplete attendees on meals; store names only | Optional; request only when the user taps "add attendee" |
| **Bluetooth / CarPlay connection state** | Reliable drive start/stop and vehicle identification when the user has more than one car | Attribute trips to a specific vehicle (needed for actual-expense method and depreciation limits) | Use connection events only; no device scanning |
| **Regular work location learning (geofences)** | Distinguish commuting (nondeductible) from business travel between work sites | Home-office and client-site geofences turn "drive detected" into "drive between work locations" | Geofences must be user-created and editable; explain commuting rules |
| **FinanceKit (Apple Card / Apple Cash)** | First-party transaction import without Plaid for Apple Card users | Same analysis pipeline as bank imports | Requires Apple entitlement approval; US only |
| **Siri Shortcuts / voice** ("log 12 miles to client site") | Frictionless manual entry while driving | Parsed through the existing voice-command API | Confirm before saving |
| **Widgets / Live Activities** | Visibility of review queue, quarterly set-aside, active trip | Read-only surfaces | No PII in widgets on shared devices |
| **Face ID / passcode lock** | Protects financial records on a shared phone | — | Use LocalAuthentication; fall back to passcode |

Deliberately excluded: microphone always-on, health data, full location history sharing, advertising identifiers, and any signal that would let the model assert deductibility without a user-confirmed business purpose.

## How mobile signals improve AI recommendations without weakening the review gates

The analysis policy in `lib/ai/transaction-tax-policy.ts` only returns `ok` when the business purpose, entity and method facts are present. Mobile signals should **answer those questions faster**, not bypass them:

1. Trip detected near a client-site geofence at the time of a restaurant charge → propose "client meal" with the calendar event and attendee facts prefilled; user confirms.
2. Receipt EXIF time matches an imported card transaction → auto-attach as documentation; deductibility still set in review.
3. Vehicle attribution + trip log → the web can compute standard mileage per trip date and flag when actual-expense records would be needed instead.

Every proposal is written as an `ai_suggestion`; confirmed-only aggregation and the 422 review responses are unchanged.

## Store and compliance prerequisites

- Apple Developer Program, App Store Connect record, TestFlight for the pilot cohort.
- **Billing:** the app sells nothing. In-app subscription sales require StoreKit and a Stripe↔StoreKit entitlement reconciliation design; until then, plans stay web-only and the app shows a neutral "manage your plan on the web" note without a link that steers purchases (Guideline 3.1.1; US external-link rules are in flux — get counsel before adding purchase links).
- **Sign in with Apple** is required if Google sign-in is added (Guideline 4.8).
- **Account deletion** must be reachable from the app (Guideline 5.1.1(v)); link to the web deletion flow.
- **Privacy nutrition labels:** precise location, photos, email; no tracking.
- **Background location review:** demo video showing classify-before-save and local deletion of personal drives.
- **Bank linking on mobile:** needs Plaid's native SDK and the approved production account; keep web-only until after the cutover in `PRODUCTION_CUTOVER_2026-09-16.md`.

## Engineering next steps

1. `cd mobile && npm install && npx expo install --fix && npm run typecheck` on a machine with network access; first EAS preview build against staging.
2. Add `expo-sensors` motion-activity gating to cut false trip starts (transit, cycling).
3. Reverse-geocode trip endpoints on device (`Location.reverseGeocodeAsync`) so saved trips read "Home → Acme HQ" instead of coordinates.
4. Calendar matching and attendee capture for meals.
5. Push notifications via Firebase Cloud Messaging with server-side topics for review queue and quarterly deadlines.
6. Face ID lock, widgets, Siri Shortcuts.
7. Regular-work-location geofences with commuting-rule guidance.
