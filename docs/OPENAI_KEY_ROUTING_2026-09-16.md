# OpenAI key routing verification — September 16, 2026

## Live key verified

The active Firebase Hosting version was `ae00beebfd59808a`, pinned to Cloud Run
service `ssrwriteoff23910` through tag `fh-ae00beebfd59808a`. The corresponding
function revision was `ssrwriteoff23910-00423-qag`.

The private deployment archive's server `.env.local` contains the OpenAI key
ending `8bcA`. An in-memory comparison confirmed it exactly matches the local
server key. No alternate OpenAI key or model override was present in those
deployment environment files. A fresh synthetic request using the deployed key
returned HTTP 200 and a valid response from `gpt-4o-mini-2024-07-18`.
No full keys, access tokens, or production taxpayer records were included in the
verification output or this report.

## Updated local implementation

All OpenAI consumers now use `lib/openai/client.ts` and the same server-only
`OPENAI_API_KEY`. Public and legacy key names are not fallbacks. The client fixes
the API endpoint to OpenAI and prevents unrelated SDK environment variables from
changing the endpoint, organization, or project. SDK request-body logging is off.

| Feature | Default model |
| --- | --- |
| Transaction analysis, including background jobs | `gpt-4o-mini` |
| Tax assistant | `gpt-4o` |
| Voice-command parsing | `gpt-4o-mini` |
| Tax-form and statement image extraction | `gpt-4o` |

`OPENAI_MODEL` provides an optional global override. Requests set `store: false`;
this does not claim to override all provider retention policies. Transaction
results save the model identifier actually returned by OpenAI.

Statement imports now write to the user's canonical account/transaction path,
preserve debit and credit direction, and enter the automatic analysis queue.
Extraction never approves a deduction. Invalid extractions are rejected before
records are written. Each batch contains at most 400 transactions.

Receipt text extraction through the existing OCR flow still uses Tesseract.
Deterministic tax calculations also remain code. These are not alternate OpenAI
credentials. The unused legacy analysis module also uses the shared client, but
should not be connected to active routes because its tax semantics are obsolete.

## Validation

- Full suite: **2,064 passed**, **11 emulator security tests skipped**.
- Production build: passed.
- Real provider calls through isolated local routes: transaction analysis, tax
  assistant, voice parsing, synthetic W-2 image extraction, and statement import
  all returned HTTP 200.
- A synthetic statement imported a $24 debit and a $6 credit. Both automatically
  completed analysis through the local Functions worker and saved model
  `gpt-4o-mini-2024-07-18`; neither was automatically approved as a deduction.
- Provider-client tests verify official endpoint routing, the same server key,
  no ambient organization/project headers, and browser rejection. Route tests
  cover authentication, missing credentials, safe errors, and model selection.

## Release scope and limits

The live key was verified; these code changes have **not been deployed**.
Production still has its earlier merchant heuristics that can skip a model call.
The new background analysis bridge remains restricted to staging/local targets.
Deploying that workflow to production requires a separate release and worker
configuration check.

Statement import supports PNG, JPEG, and WebP images with explicitly identified
USD currency. PDF statements and expense reports are not accepted by this route.
The separate tax-document route's PDF behavior was not validated in this pass.
These checks establish credential routing and the tested flows; they do not
establish universal tax correctness or comprehensive production readiness.
