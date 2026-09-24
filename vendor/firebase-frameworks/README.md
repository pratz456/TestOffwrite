# Firebase frameworks auth-cache patch

`../firebase-frameworks-0.11.8-writeoff.1.tgz` is the production dependency. It is
derived from the official `firebase-frameworks@0.11.8` npm package. The upstream
version and tarball integrity are pinned in
`scripts/build-firebase-frameworks-patch.mjs`; both the original and patched
`dist/firebase-aware.js` SHA-256 hashes are checked before rebuilding. Upstream
0.11.8 was the latest stable npm release checked on September 24, 2026.

The readable `firebase-aware.js` here replaces that one upstream runtime file:

- An expired LRU entry is not returned after disposal.
- After awaited revocation verification, a cold request checks for an app that a
  concurrent request already created. Creation and cache insertion stay synchronous.
- Each request retains its app through authentication, asynchronous rendering and
  response finish/close. LRU eviction deletes an app only after its last request
  completes; disconnects during authentication and render errors release safely.

Cookie verification, revocation-check placement, cookie lifetime and options,
cache capacity/TTL, UID isolation and normal authorization are unchanged. This
does not skip authentication or enable an auth fallback.

## Why a tarball

Firebase CLI 14.27.0 removes root `scripts` and `devDependencies` when creating
the Next.js SSR package. A root `postinstall` or local `node_modules` edit would
not provide a durable cloud fix. Its framework packager preserves an explicit
`firebase-frameworks` dependency, copies `file:` tarballs into the generated
functions directory, and rewrites the path to the copied basename. The uploaded
package therefore contains the patched bytes for a fresh cloud install, including
installs with lifecycle scripts disabled. The committed lockfile pins its integrity.

The focused test executes the installed CLI's actual copy/rewrite block without
environment files or provider access. Keep that check when upgrading Firebase CLI.
Release preparation archives tracked blobs, so it includes this tarball.

## Rebuild and verify

From the repository root, using Node 22:

```sh
node scripts/build-firebase-frameworks-patch.mjs
npm install --ignore-scripts --no-audit
npx vitest run tests/firebase-frameworks-auth-cache.test.ts
npx tsc --noEmit
```

The builder downloads only the exact pinned upstream npm package, or accepts an
already downloaded upstream tarball as its first argument. It does not edit an
installed dependency, deploy or call application providers. Deliberate patch
updates require reviewing the new source and updating its hash and package version.
Normal application/cloud installs use the committed tarball without rebuilding it.

Behavior tests evaluate the shipped adapter body with mocked Firebase APIs and the
real installed LRU implementation under a deterministic clock. They cover stale
expiry, concurrent cold misses, revoked-cookie races, capacity eviction during
sign-in, disconnects, multiple streaming requests, render/auth failures and session
policy. The readable source, installed source and packaged source must match.

Only `dist/firebase-aware.js` and package version metadata change from upstream;
the Apache 2.0 license from the upstream repository is also included. All other
upstream runtime files are preserved. Replace this package with an official fixed
release once the same lifecycle tests pass against it.

Upstream: https://www.npmjs.com/package/firebase-frameworks

Repository/license: https://github.com/firebase/apphosting-adapters
