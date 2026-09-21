# WriteOff mobile (iOS first)

Native companion app built with Expo / React Native. It reuses the existing web API and Firebase Auth project; it does not contain its own tax logic, billing, or bank credentials.

## What it does today

- Sign in with an existing, email-verified WriteOff account (Firebase ID tokens are sent as `Authorization: Bearer`).
- Automatic drive detection with background location (`expo-location` + `expo-task-manager`). Detected drives are **candidates**: the user marks each one Business (with a required business purpose) or Personal. Business trips are saved through `POST /api/mileage`; personal trips are deleted on the device and never uploaded.
- Receipt capture from camera or photo library, OCR through `POST /api/receipts/process` (`mode=ocr`), user review, then save (`mode=commit`). A missing date is never defaulted.

Automatic detection is the only feature that needs "Always" location access. Apple requires the purpose strings in `app.config.ts` to match real behavior; do not expand them without adding the behavior.

## Not in this app on purpose

- No subscription purchase or upgrade buttons. Selling subscriptions inside an iOS app requires StoreKit (App Store Review Guideline 3.1.1); the web plans stay web-only until StoreKit + entitlement sync is designed.
- No bank linking. Plaid Link on iOS requires the native Plaid SDK and an approved production account; keep it on the web until that rollout is complete.
- No tax filing, refund promises, or "finds every deduction" claims. Copy must match the web product's review-gated language.

## Build

Requires macOS + Xcode for local device builds, or an Expo EAS account for cloud builds.

```sh
cd mobile
npm install
npx expo install --fix          # aligns native module versions with the pinned Expo SDK
npm run typecheck
EXPO_PUBLIC_FIREBASE_API_KEY=... EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=... \
EXPO_PUBLIC_FIREBASE_PROJECT_ID=... EXPO_PUBLIC_FIREBASE_APP_ID=... \
npx expo start
```

Point `EXPO_PUBLIC_API_BASE_URL` and the Firebase variables at the **same** project (staging `writeoff-production-testing` for testing; production only after the web cutover). The Firebase web config values identify the project and are not secrets, but never put admin keys, Plaid, Stripe, or OpenAI values in this app.

Cloud builds: `npm run build:ios:preview` (internal TestFlight-style install) and `npm run build:ios:production`, then `npm run submit:ios`. `eas.json` selects the API base URL per profile.

## App Store checklist (before submission)

- Apple Developer Program membership, bundle ID `com.writeoffapp.mobile`, App Store Connect record.
- Privacy nutrition labels: precise location (app functionality), photos (app functionality), email (account). No tracking, no third-party advertising SDKs.
- Background location review notes: explain trip detection, the classify-before-save flow, and local deletion of personal trips.
- Sign in with Apple is required if Google sign-in is added to the mobile app (Guideline 4.8).
- Support URL, privacy policy URL, and account-deletion path (the web account deletion flow satisfies Guideline 5.1.1(v); link to it).

See `docs/MOBILE_APP_PLAN_2026-09-17.md` for the roadmap of additional device signals and their privacy constraints.
