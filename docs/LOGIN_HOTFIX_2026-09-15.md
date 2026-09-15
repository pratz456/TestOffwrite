# Live login hotfix — 2026-09-15

## Initial header repair

The live login response blocked `https://apis.google.com` in `script-src` and
`https://writeoff-23910.firebaseapp.com` in `frame-src`. Google sign-in failed with
`auth/internal-error`. Firebase's Google and email/password providers were enabled,
and the live domains were already authorized.

Add only those required resources to the login page's existing Content Security
Policy. The Hosting override covers `/auth/**` and `/login`; all other restrictions
remain in place. The same headers are checked into `firebase.json` for subsequent
deployments.

Production was updated by cloning the active Hosting version, preserving every
asset and its pinned Cloud Run rewrite, updating only these headers, and releasing
the new version. No application bundle, database rule, provider credential or user
record was changed.

- Prior version: `17c086c1c0be1937`
- Hotfix version: `7a422202b2f5be76`
- Released: `2026-09-15T20:08:42.065Z`
- Release: `sites/writeoff-23910/releases/1789502922065000`

HTTP verification confirms the corrected single policy on the live login URL.
A full successful user sign-in requires the user's credentials and was not claimed
from the negative email login test.

## Authentication startup code

Initialize Firebase Authentication with its normal browser persistence options,
without eagerly initializing the cross-origin Google popup/redirect helper. Pass
that helper explicitly to Google popup, redirect and redirect-result operations.
Email/password startup can then complete independently; Google support remains
available on demand.

This isolated change is based on the deployed branch. It does not include the
larger local tax, billing, entitlement or landing-page changes. The error-page
home link also uses Next.js `Link` to pass the existing production lint check.

Validation: 19 existing tests passed, the production build passed with type and
lint checks enabled, and an independent review checked all three OAuth call sites.
The previous deployment's private environment settings are preserved exactly in
the deployment bundle and excluded from Git. The original Hosting release remains
available for rollback.

The code update was deployed successfully to Firebase Hosting and its SSR backend:

- Code commit: `9194145`
- Hosting version: `954a8bf3450f24de`
- Released: `2026-09-15T20:41:13.476Z`
- Release: `sites/writeoff-23910/releases/1789504873476000`

Both `writeoffapp.com` and `www.writeoffapp.com` return HTTP 200 for the login
page, reference the new bundle and include the corrected policy. The downloaded
live bundle matches the locally built bundle by SHA-256. The browser now restores
an authenticated session, reaches `/protected`, loads saved account data and
retains dashboard access after a full reload. Fresh credential entry through both
providers was not independently completed; this verifies session restoration and
dashboard access, not every account or browser.
