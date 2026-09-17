# Transaction AI: tax grounding and limits

## Implemented contract

Every successful fresh model response carries a server-derived transaction tax year, `US-federal` jurisdiction, policy version, model provenance and source records. The model chooses evidence IDs from a fixed packet. The server resolves official titles, URLs, review dates and publication editions; it does not accept model-written links or unrestricted publication/section citations.

Transaction kind and category are separate from tax eligibility. A supplies category can be ready to confirm while a missing business purpose keeps eligibility unresolved. The server never turns uncertainty into a personal expense, guesses a mixed-use percentage, or labels an unexplained deposit as income. An AI suggestion does not itself change the user's confirmed tax decision.

Policy version: `federal-transactions-2026-09-17.1` (item-recognition gates and identifier redaction added 2026-09-17; the 2026-09-16.1 packet had the same evidence list). This is a selected federal sole-proprietor/disregarded single-member LLC transaction policy for 2025 and 2026. It is not coverage of the full Code, state tax, complete returns, all entities or 2027 law. Unsupported scope retains useful categorization but withholds tax treatment.

## Reviewed primary material

- [26 USC 162](https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title26-section162&num=0&edition=prelim): ordinary/necessary trade or business expenses require facts about use. A business account or familiar merchant is insufficient.
- [26 USC 262](https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title26-section262&num=0&edition=prelim): personal spending is not automatically a business deduction.
- [26 USC 274](https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title26-section274&num=0&edition=prelim) and [2026 Publication 15-B](https://www.irs.gov/publications/p15b): meal conditions and exceptions matter; some employer meal rules change after 2025. A blanket 50% meal rule is unsafe.
- [Publication 463 (2025)](https://www.irs.gov/publications/p463): commuting, business travel, substantiation and vehicle-method restrictions. The packet includes selected general principles and no annual mileage rates.
- [26 USC 263](https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title26-section263&num=0&edition=prelim) and [Publication 946 (2025)](https://www.irs.gov/publications/p946): capitalization and asset elections need separate analysis. Vehicle weight alone does not establish a full write-off.
- [Publication 587 (2025)](https://www.irs.gov/publications/p587): home-office eligibility and method require additional facts.
- [Publication 334 (2025)](https://www.irs.gov/publications/p334): distinguish business receipts, other money movements and recovery of prior deductions. Match a refund to its original purchase and tax year.

The current IRS publications above are labeled 2025 editions as reviewed September 16, 2026. They are not presented as finalized 2026 return instructions, and no annual amount is extrapolated. Publication 535 is discontinued and was removed from this analyzer's legacy guidance. See the IRS [recommended reading](https://www.irs.gov/businesses/small-businesses-self-employed/recommended-reading-for-small-businesses).

## Deterministic safeguards and remaining scope

- Reject unknown, duplicated or category-inapplicable evidence IDs, arbitrary source URLs, unsupported prose citations and contradictory completed fields.
- Derive the tax year from the saved transaction date. Withhold treatment outside 2025/2026 or the supported business entities.
- Preserve known category/kind when additional facts are needed. Ambiguous credit/transfer types remain unknown and require identification before reporting.
- Require original purchase/year review for refund tax adjustments. A negative amount never creates a new positive expense deduction.
- Simple supported ordinary expenses can carry a recommendation. Mixed-use percentages must come from the saved transaction. No savings amount is estimated from a guessed tax rate.
- Meals, travel, vehicles, home offices and assets retain categorization but remain in tax review in this bounded packet. The current transaction form does not collect all conditions/elections needed to approve them automatically. Answering a general notes question is not a complete depreciation or eligibility workflow.
- Item-recognition gates (2026-09-17.1) read the saved context, merchant descriptor and the model's own item description, but only to ask more: self-employed health/dental/vision premiums are routed to Schedule 1 (Form 7206) instead of Schedule C; gym, health-club and similar dues get the §274(a)(3) exclusive-business-use question; rent whose context names the taxpayer's home gets the home-office questions; a supplies/other item over $2,500, or $500 and up when it names a durable item, gets the capitalization/de minimis election question. None of these patterns can approve a deduction.
- SSN/ITIN/EIN-shaped digit groups are replaced with `[redacted-id]` in merchant, note, purpose, project and meeting text before the prompt is built.
- Offline regression: `tests/ai-eval-harness.test.ts` (73-case golden corpus with invariants and a scorecard) and `tests/ai-eval-redteam.test.ts` (47 adversarial checks). Remaining documented concerns: injected note text counts toward the length-only purpose gate, and the pending flag does not defer a suggestion (pending records are already excluded from Schedule C totals).
- Explanations include a next question and supporting-record checklist. The model still performs semantic interpretation; official citations and these guards reduce unsupported output but do not prove that every interpretation is correct.

## Review flow

- One tap, one decision. When a saved suggestion carries `proposed_purpose` (or, for older results, the model's customized reason) and no business purpose is saved, the detail and review screens show a "Confirm purpose" chip with an inline edit. Nothing is pre-selected; the tap is the user's decision. A saved `ai_explanation` renders through `ExplanationCard`; otherwise the suggestion's reasoning shows as before.
- Confirming PUTs `business_purpose`, `is_deductible: true`, `expense_type: 'business'` and `user_classification_reason: 'confirmed_ai_proposal'` to the existing `/api/transactions/[id]` route. The server (`taxDecisionUpdate`) stamps `review_status`, `reviewed_at` and derives `review_source`: `ai_confirmed` only when the record carries a saved suggestion, `user_corrected` for "Not business" (`is_deductible: false`), otherwise `user_decision`. Clients never write review fields.
- The chip is withheld for bank-pending rows, credits, non-expense suggestions and categories whose tax method needs its own review (equipment, vehicle, home office, other); those keep the category flow and the details form.
- `POST /api/transactions/bulk-confirm` applies one merchant decision (`{ merchantKey, decision, businessPurpose?, category? }`) to the caller's unreviewed charges with the same `learningMerchantKey`: same-origin only, authenticated, `RATE_LIMITS.bulkConfirm` (20 per 10 minutes), reads only `user_profiles/{uid}` plus owner-filtered legacy root rows, 200 newest charges per call (`truncated: true` beyond), batches of at most 400 with the same stamps as the single route, one learning correction per merchant. Charges the analysis read as income, transfers, refunds or personal, and categories with their own tax method, are skipped and counted.
- After a single decision, "Apply to N similar charges from <merchant>" appears when two or more other unreviewed charges share the merchant key; the result count comes from the server response.
- The review screen's "By merchant" layout groups unreviewed charges by merchant key (most frequent first) with count, total, the proposed purpose from any suggestion in the group and the suggested category only when every expense suggestion agrees. Group Confirm / Not business use the bulk route. Single cards remain the default.
- When a suggestion has `questions`, only `questions[0]` is asked, with answer chips derived from `missing_fields[0]`: the proposed purpose plus "Something else"; 100/75/50/25 business-use chips saving `equipment_details.business_use_percentage`; "Client meal (add attendees)" saving `attendees`; a Settings link for entity and tax-year gates. Chips save allow-listed facts only and never record a deduction.
- Copy follows the claims policy: no outcome promises, no filing language, no "fully deductible". Tests: `tests/review-one-tap-client.test.ts`, `tests/bulk-confirm-route.test.ts`, `tests/review-flow-ui.test.tsx`.

## Validation

Focused provider and grounding tests verify strict schema compatibility, server provenance/source resolution, malformed citations, unsupported years/entities, business-purpose requirements, mixed use, complex categories, refunds, ambiguous deposits/transfers and concrete next questions. Provider mocks are contract tests, not evidence of live model tax accuracy. Live synthetic evaluation and worker/browser verification are recorded separately by the root task.
