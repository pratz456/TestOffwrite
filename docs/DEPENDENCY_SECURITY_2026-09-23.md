# Targeted dependency security update

Checked September 23, 2026. These findings describe the current branch's installed and locked dependency graph, not a verified live deployment. No framework-major or Firebase CLI migration was performed.

## Applied changes

| Dependency path | Before | After | Reason |
| --- | --- | --- | --- |
| `next` | 15.5.25 | 15.5.26 | Compatible patch; the upstream release includes additional `next/og` security hardening. |
| `next → postcss` | 8.4.31 | 8.5.28 | Scoped override removes source-map disclosure and other audited PostCSS advisories. |
| `@ducanh2912/next-pwa → workbox-build → @rollup/plugin-terser → serialize-javascript` | 6.0.2 | 7.0.7 | Scoped override includes code-injection, array-like input exhaustion and spoofed-RegExp fixes. |

The serializer's documented v7 runtime requirement is Node 20 or later; this application already specifies Node 22. CommonJS imports and the actual Rollup/Workbox production minification path were checked. The narrow overrides remain explicit in `package.json`; the lockfile records resolved versions. Evidence-intake dependencies added by the parallel workstream were preserved.

Official sources: [Next 15.5.26 release](https://github.com/vercel/next.js/releases/tag/v15.5.26), [PostCSS remaining source-map fix](https://github.com/postcss/postcss/security/advisories/GHSA-fxqj-rqcc-2cmp), [serializer injection advisory](https://github.com/yahoo/serialize-javascript/security/advisories/GHSA-5c6j-r48x-rmvq), [serializer exhaustion advisory](https://github.com/yahoo/serialize-javascript/security/advisories/GHSA-qj8w-gfj5-8c6v), [serializer v7 runtime requirement](https://github.com/yahoo/serialize-javascript/releases/tag/v7.0.0), [serializer 7.0.7 hardening](https://github.com/yahoo/serialize-javascript/releases/tag/v7.0.7).

## Verification

- `npm ls next postcss serialize-javascript --all`: all targeted versions resolved, no invalid dependency nodes.
- Actual production `workbox-build.generateSW` compiled two synthetic assets with zero warnings, exercising the Rollup serializer/minifier.
- A synthetic external source-map disclosure fixture remained unreadable in generated PostCSS output.
- Serializer round-trip retained legitimate RegExp, Date and function options; the advisory's spoofed-RegExp injection shape did not execute its synthetic marker in an isolated VM.
- Fresh `npm audit --omit=dev --json`: **9 moderate, 0 high, 0 critical**, versus **16 moderate and 2 high** before this update. Audit counts include affected parent packages, not just distinct underlying vulnerabilities.
- Full installed-tree audit: **16 moderate, 1 high, 3 critical**. Full app build and integrated tests are covered by the parent release-validation run, not claimed by these dependency-specific checks.

The nine remaining production-tree moderate entries are `uuid` and affected parent paths through Firebase Admin/Google Cloud clients and ExcelJS. npm's suggested remedies include major upgrades or an ExcelJS downgrade; those were not forced as part of this bounded fix. Production-tree inclusion does not establish that an advisory is reachable through a public application request.

## Development-tool critical entries

| Audit entry | Actual installed path | Scope and follow-up |
| --- | --- | --- |
| `vitest` | Root dev dependency `vitest@3.2.4` | UI/API-server arbitrary file access/execution advisory. The project test command is `vitest run`, not an exposed UI service. Update the paired Vitest packages in a dedicated tooling change; the current npm advisory database requires at least 3.2.6 for this critical item, while a separate moderate advisory requires a newer major. |
| `@vitest/ui` | Root dev dependency `@vitest/ui@3.2.4`, exact peer of Vitest | Same underlying Vitest advisory propagated to the UI package, not an independent production vulnerability. Keep UI/browser-test APIs off public interfaces. |
| `tar` | Root dev dependency `firebase-tools@14.27.0 → tar@6.2.1` | Archive extraction/parse and path-handling advisories in deployment/emulator tooling. npm proposes Firebase CLI 15.31.0, a major change requiring deployment/emulator validation. A separate optional path through `node-gyp` already has `tar@7.5.22`. |

These three critical entries do **not** appear in `npm audit --omit=dev`. They still warrant development/CI remediation. The remaining full-tree high entry is the affected Firebase CLI parent path. Sources: [Vitest UI advisory](https://github.com/vitest-dev/vitest/security/advisories/GHSA-5xrq-8626-4rwp), [node-tar parse exhaustion advisory](https://github.com/isaacs/node-tar/security/advisories/GHSA-23hp-3jrh-7fpw).
