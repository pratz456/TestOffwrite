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

## Validation

Focused provider and grounding tests verify strict schema compatibility, server provenance/source resolution, malformed citations, unsupported years/entities, business-purpose requirements, mixed use, complex categories, refunds, ambiguous deposits/transfers and concrete next questions. Provider mocks are contract tests, not evidence of live model tax accuracy. Live synthetic evaluation and worker/browser verification are recorded separately by the root task.
