# WriteOff: sourced deduction assistant foundation

Local implementation and research as of **September 15, 2026**, on `codex/prelaunch-readiness`. No push or deployment is part of this change.

A subsequent [pre-launch fix batch](PRELAUNCH_FIXES_2026-09-15.md) corrects several calculator, onboarding, payment-record and security issues described as outstanding below. This document preserves the scope and validation of the original assistant work.

## What the user can do

The existing assistant screen becomes **“Can I write this off?”**:

- Choose tax year 2026 or 2027 and ask about a purchase.
- Attach one JPEG, PNG or WebP photo up to 2 MiB; preview or remove it before submitting. The UI explains that the submitted question and photo go to OpenAI.
- Receive a conditional explanation, linked official sources, and a checklist of missing facts.
- Click a follow-up question and supply an answer. Recent text context includes the prior source-backed explanation, questions and explicitly unverified photo observations; it does not resend prior photo bytes.
- Keep the draft and photo if authentication, configuration or the provider fails. Changing years starts a new conversation.

The first reviewed topics are general business expenses, vehicles, depreciation, self-employed home offices and business meals. The September 17, 2026 content review added the One Big Beautiful Bill Act topics: qualified tips and overtime (with the self-employed net-income cap, SSTB exclusion and the contractor-overtime caveat), qualified vehicle loan interest, the enhanced senior deduction, Form 1099-K / 1099-NEC reporting thresholds (year-aware; the indexed 2027 1099-NEC amount is described as unpublished) and the 2026 charitable deduction for non-itemizers. Statutory OBBBA dollar amounts are quoted because they are fixed through 2028; indexed annual amounts are never quoted. This is a guided assessment workflow, not a complete tax adviser or filing service. Photos classify possible item categories; they do not establish amounts, ownership, manufacturer specifications, business purpose or eligibility. Detailed receipt extraction remains separate work.

## How answers are grounded

The authenticated route no longer constructs an “exact tax owed” prompt from partial, mixed-year account data. The separate unvalidated tax-estimate banner has also been removed from this screen.

The model receives selected reviewed guidance packets and may return only:

1. A supported topic enum, or an unsupported-topic result.
2. IDs for missing facts from that topic's checklist.
3. A small set of possible photo categories.

The server constructs the actual legal explanation, questions, photo labels and citation URLs from reviewed content. Unknown fields, invented facts/IDs, free-text legal conclusions and malformed output become a clarification. A model cannot insert a new tax conclusion by attaching an allowed citation ID. The model can still select the wrong topic or omit a needed question; conditional wording and the full photo checklist do not constitute proof of eligibility or complete semantic validation.

No amount, tax savings, refund or final eligibility decision is calculated. W-2 employee exceptions, detailed asset exceptions, unsupported entity situations, retirement, credits, full-return calculations and state/international tax need further reviewed coverage. The reviewed publication editions are labeled, and 2027 responses include an explicit annual-amount availability notice.

Implementation:

- `app/api/ai/tax-assistant/route.ts`: authentication, bounded request, provider call and response.
- `lib/tax-assistant/contract.ts`: schemas, streamed body limit and image byte signatures.
- `lib/tax-assistant/knowledge.ts`: source provenance, supported years and fact checklists.
- `lib/tax-assistant/guidance.ts`: reviewed explanations and constrained model routing.
- `components/tax-assistant-screen.tsx`: photo/chat interface and recoverable request state.

## Research completed

Three parallel workstreams produced:

- [Federal year rules](research/federal-year-rules-2026-2027.md): 2026 parameters, eligibility inputs, enacted future changes, unpublished 2027 values and reference scenarios.
- [Business deductions](research/business-deductions-2026-2027.md): Section 179, bonus depreciation, vehicle classification, substantiation, business expenses, meals and home-office conditions.
- [Architecture audit](research/assistant-architecture-audit.md): baseline data flow, estimation defects, photo/import risks and implementation boundaries.

These reports are engineering research, not professional sign-off on every provision. They distinguish final IRS material, enacted statutes and draft instructions. Annual 2027 amounts that were not found published as of the review date are left unavailable; enacted rules that already determine some 2027 treatment are documented separately.

### Full Title 26 search corpus

The official House Office of the Law Revision Counsel archive at release **Online@119-103** was downloaded and indexed. Its XML creation timestamp is September 9, 2026. The index contains **2,161 section entries**, including 241 marked repealed, 17 renumbered, two reserved and two omitted. The remaining 1,899 lack a source status; that does not prove they are all currently effective.

The index retains section headings, hierarchy, source status, full descendant text, source/effective-date notes, byte offsets and SHA-256 hashes. [The manifest](research/title26-corpus-manifest.json) records the exact source, counts, hashes and limitations. It is a reproducible local research tool; **the full corpus is not connected to live assistant retrieval**.

To reproduce in a new checkout, first download the exact official archive into the ignored research directory:

```sh
mkdir -p .tax-research
curl --fail --location 'https://uscode.house.gov/download/releasepoints/us/pl/119/103/xml_usc26@119-103.zip' --output .tax-research/title26-119-103.zip
python3 scripts/index-tax-code.py build --verified-on 2026-09-15
python3 scripts/index-tax-code.py validate
python3 scripts/index-tax-code.py lookup 162 179 280F
python3 scripts/index-tax-code.py search 'ordinary and necessary' --limit 5
```

Compare source hashes with the checked-in manifest before treating a later download as the same snapshot. Do not carry the original verification date forward to newly revised source material.

A current Code compilation is not a complete historical 2026 or future 2027 ruleset. Effective dates, transition rules and inflation adjustments still require interpretation. Treasury regulations, judicial decisions, IRS procedures/rulings, form instructions and state law need their own coverage. Indexing every selected section is not the same as reviewing or understanding every section.

## Validation and practical limits

`npm run ci` passed: **68 tests across seven files**, zero lint errors and a successful production build. There are 39 new assistant backend tests; pre-existing repository lint warnings remain. Changed assistant code passes targeted lint. After the final prompt simplification, the 39 assistant tests passed again.

Additional temporary harnesses exercised the real component's request/file handlers and React rendering with synthetic state and mocked API calls. Visual browser checks covered desktop (1280 × 720), mobile (390 × 844), the 2027 notice and an attached-photo state using rendered component markup and built styles. A cramped mobile header was corrected. These checks do not replace a fully authenticated browser session, a live model evaluation or native mobile camera/keyboard testing.

Automated tests use synthetic data and mocked authentication/provider calls. They cover authentication failures, supported years, role/history limits, actual streamed request size, image type/size/signatures, single delivery of a current question/photo, rejection of model-written conclusions, reviewed citations, photo fact gates, unsupported topics, 2027 availability, bounded context, provider refusal/truncation and non-disclosure of raw provider errors.

Image validation checks format signatures and byte limits, not full decoding or image authenticity. Application code does not persist advisory photos or conversations to Firestore or request OpenAI response storage; this does not establish a provider-wide zero-retention guarantee. A submitted image is still sent to the configured provider for analysis.

No live OpenAI request was made during this work: a local API key was unavailable. Production credentials and customer financial records were not retrieved to test the new flow. Full authenticated signup, banking, billing and assistant end-to-end validation is still required in the testing project. Provider capacity, per-user usage limits, abuse handling and operational review of source updates are release work.

The old tax calculation defects documented in [the tax engine review](TAX_ENGINE_REVIEW_2026-09-15.md) remain unresolved outside this assistant. Passing the application build and these workflow tests does not validate their financial outputs.

## Next product milestones before broad GTM

1. **Make calculation results trustworthy.** Consolidate tax-year rules, correct the reproduced child-credit/SEP/year/quarterly defects, validate IRS-form-based fixtures and obtain qualified review of the supported scope.
2. **Turn a question into a documented expense.** User confirms business purpose, use percentage and applicable facts; save the receipt and source/rule version with the reviewed transaction through an explicit save action.
3. **Create one reliable income and expense ledger.** Reconcile banks, manual entries and tax forms; show missing information and sync status. Every screen and export must agree.
4. **Make onboarding produce a useful first result.** Support bank linking plus import/manual alternatives, clear recovery from failures and a review queue.
5. **Pilot a defined audience.** Start with a limited set of self-employed federal scenarios, measure successful first reviews and repeat use, and expand coverage from actual unresolved questions before broad acquisition.

Adding more source text alone will not complete these milestones. The useful product combines current authority, explicit factual inputs, deterministic calculations, supporting records and clear review boundaries.
