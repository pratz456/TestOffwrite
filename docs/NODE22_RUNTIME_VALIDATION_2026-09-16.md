# Node 22 runtime upgrade — September 16, 2026

## Change

The Next.js app now declares `engines.node: "22"`, matching both Cloud Functions packages. `.nvmrc` pins the locally tested Node **22.23.2** release. The npm lockfile records the same root engine, and GitHub CI/deploy jobs read `.nvmrc` instead of selecting Node 20 separately.

The deployment wrapper rejects another Node major before cleaning, installing, building, or deploying. Existing Windows version-selection helpers and setup instructions now select 22.23.2. The legacy `ensure-node-20.ps1` filename remains available for existing shortcuts; its contents select Node 22.

No dependency versions, application logic, provider configuration, or deployed services were changed by this runtime preparation.

## Why this works with the current Firebase integration

- [Firebase documents Node 22 support and selection through package engines](https://firebase.google.com/docs/functions/manage-functions#set_nodejs_version).
- [Google's runtime schedule](https://docs.cloud.google.com/functions/docs/runtime-support) lists Node 20 decommissioning on October 30, 2026; Node 22 decommissioning is October 31, 2027.
- Installed `firebase-frameworks` **0.11.8** declares Node 22 in its engine range.
- Installed Firebase CLI **14.27.0** reads the application's package in its actual Next.js `ɵcodegenFunctionsDirectory` adapter and preserves the explicit Node engine when preparing the server package. Its Functions runtime parser accepts the result as `nodejs22`.
- That CLI's old framework warning list still contains only 16/18/20. It can print an integration warning when the CLI runs on Node 22; it does not replace an explicitly configured engine. No installed dependency files were patched to suppress the warning.
- [Framework-aware Hosting remains a preview integration](https://firebase.google.com/docs/hosting/frameworks/nextjs). This change does not migrate hosting products or upgrade that adapter.

## Validation performed

Validation ran in `/tmp/writeoff-node22-build`, with separate build output and a read-only-use link to the existing dependency installation. The active checkout's `.next` and `.firebase` outputs were left alone while its prior deployment ran.

1. **Full automated suite under Node 22.23.2:** 2,467 passed; 13 emulator-only security cases skipped because no emulator was selected. Log: `/tmp/writeoff-node22-tests.log`.
2. **Production Next.js build:** exit 0, including application typechecking, lint checks, page generation, and tracing. Existing lint and Browserslist warnings remain. Log: `/tmp/writeoff-node22-build.log`.
3. **Actual Firebase Next adapter generation:** generated `engines.node: "22"`; actual Firebase runtime parser returned `nodejs22`. The generated server directory included the Plaid webhook and internal analysis-worker routes. Log: `/tmp/writeoff-node22-codegen.log`; output: `/tmp/writeoff-node22-ssr-k9rCXM`. The adapter used the existing esbuild installation; no install or deployment ran.
4. **Native receipt OCR:** build tracing includes the Tesseract worker and WASM cores; a synthetic receipt produced 99 characters at 95% confidence under Node 22.
5. **Production-server HTTP smoke:** homepage and sign-in returned 200; unauthenticated subscription access and bank-link creation returned 401. Requests supplied the HTTPS proxy header expected behind Firebase. Log: `/tmp/writeoff-node22-smoke.log`. The temporary local server was stopped.
6. **Deployment-wrapper gate:** Node 20/24 were rejected before any filesystem/build/deploy command; Node 22 reached stubbed commands. No command in this gate check performed a deployment.
7. **Metadata consistency and diff whitespace checks:** passed. Windows helpers received version-only edits and were not executed on this macOS host.

## Rollout boundary

The source change is ready for a **staging runtime deployment and smoke check**. This validation did not deploy Node 22 to staging or production. After the next staging deployment, verify the generated SSR function's cloud runtime is `nodejs22` and rerun the provider/browser smoke checks before production promotion. Keep the package engine explicit; changing only the local Node binary leaves the old SSR runtime unchanged.
