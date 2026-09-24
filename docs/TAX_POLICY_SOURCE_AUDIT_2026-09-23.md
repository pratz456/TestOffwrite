# Tax policy source audit — September 23, 2026

## Scope and result

Reviewed the transaction policy, transaction explanations, assistant knowledge/routing packets and selected state parameters in `codex/2027-tax-coverage` (working tree based on `164dc60`). This was a bounded legal-source audit, not certification of the entire Internal Revenue Code, every state return or production deployment. No customer records or Firebase data were used. The initial statutory audit was read-only research plus local regressions; the later provider validation uses only synthetic transactions and the configured server key, without recording credentials.

The initial source pass identified seven material issues. Six were corrected in this audit's owned files; the refund explanation correction was coordinated with the parent agent and is present in the working tree. A later review of synthetic live-provider outputs identified five further unsafe approvals or tax-line errors, corrected below. Source review uses official IRS publications, enacted legislation and state tax authorities. Published 2027 amounts are distinguished from figures still pending verification.

## Findings and corrections

### 1. Solo meals were incorrectly treated as explicitly personal

- **Location:** `lib/ai/transaction-tax-policy.ts`, `SOLO_MEAL_NOTE` and the `solo_meal_context` gate (lines 336, 534 at review completion).
- **Before:** A note such as “Dinner alone while away overnight for a client conference” matched the explicit-personal regular expression.
- **Correction:** Eating alone triggers a question about tax home, travel, sleep/rest, dates and purpose. Explicit personal-use notes still prevail. Local routine meals remain nonqualifying unless different facts establish a permitted exception. No meal is automatically approved.
- **Authority:** [IRS Publication 463, Travel meals](https://www.irs.gov/publications/p463). Qualifying travel meals do not require a client to attend.

### 2. IRS payees were rejected even for deductible employer taxes

- **Location:** `lib/ai/transaction-tax-policy.ts`, `federalBusinessTax` and `business_tax_components` (lines 419, 560–566).
- **Before:** Every federal payee was excluded from the business-tax exception.
- **Correction:** Stated payroll/FUTA/highway-use/excise tax payments require a return/ledger and component review. The proposed category is taxes and licenses; eligibility and percentage remain unset. Employee withholding cannot be deducted again if already included in gross wages. Personal income and self-employment tax remain excluded from Schedule C.
- **Authority:** [Schedule C instructions, line 23](https://www.irs.gov/instructions/i1040sc), which list employer matching Social Security/Medicare, federal unemployment and highway-use taxes.

### 3. The $2,500 safe harbor was presented as a universal capitalization rule

- **Location:** `lib/ai/transaction-tax-policy.ts`, supplies evidence and asset/repair gates (lines 102–103, 722–734).
- **Before:** A large invoice implied an asset or improvement; smaller property was said to require the annual safe-harbor election in every case. Exactly $200 entered asset review despite the materials-and-supplies threshold being inclusive.
- **Correction:** Retained review for unresolved purchases, but asks item cost and treatment without declaring capitalization from a charge total. Describes $2,500 without an applicable financial statement and $5,000 with one, per-item/per-invoice treatment, book-expensing and annual election. Preserves ordinary supplies/repair alternatives. Exactly $200 no longer enters this asset gate solely because of cost.
- **Authority:** [IRS tangible property regulations guide](https://www.irs.gov/businesses/small-businesses-self-employed/tangible-property-final-regulations), de minimis and materials/supplies sections; Treas. Reg. §§1.263(a)-1(f), 1.162-3. Amounts above the safe-harbor limit may still be ordinary deductible repairs/supplies.

### 4. The refund headline erased the prior-year tax-benefit distinction

- **Location:** `lib/ai/explanation.ts`, records rule and refund headline (lines 96, 163).
- **Before:** Every refund was described as reducing the original expense.
- **Correction:** Parent agent changed the explanation to require matching the purchase and tax year. The existing transaction policy already withholds a tax adjustment until that reconciliation occurs.
- **Authority:** [IRS Publication 525, Recoveries](https://www.irs.gov/publications/p525). Same-year refunds generally reduce the related deduction; prior-year recovery can be current income to the extent of the earlier tax benefit.

### 5. Business-loss guidance omitted passive-activity limits

- **Location:** `lib/tax-assistant/knowledge.ts`, `business-losses` and `passive-losses-925` (lines 773–791).
- **Before:** The packet asserted a wage offset after three checks and omitted material participation.
- **Correction:** Added the passive-activity limitation, participation question, Form 8582 and a primary-source citation. Changed the statement to conditional treatment after all applicable limitations. The 2027 excess-business-loss threshold remains pending, not a reused 2026 amount.
- **Authority:** [IRS Publication 925](https://www.irs.gov/publications/p925), passive activities, material participation and ordering of at-risk/passive limits; [Form 461 instructions](https://www.irs.gov/instructions/i461).

### 6. Vehicle-interest guidance incorrectly excluded mixed business use

- **Location:** `lib/tax-assistant/knowledge.ts`, `vehicle-loan-interest` (lines 228–237).
- **Before:** Business use was described as necessarily outside the new vehicle-interest deduction.
- **Correction:** Uses the final expected-personal-use test when the debt is incurred: more than 50% personal use over expected ownership. Eligible mixed-use vehicles can qualify; independently deductible business interest can be allocated to the appropriate alternative treatment with no double deduction. Keeps loan, vehicle, income, records and separate-calculation conditions. No calculator eligibility was expanded.
- **Authority:** [T.D. 10054, IRS Bulletin 2026-39](https://www.irs.gov/irb/2026-39_irb), §1.163-16(f)–(h), including expected use and independently deductible interest. This final guidance was published in the September 21, 2026 bulletin. Earlier generic public summaries were insufficient for this detail.

### 7. Georgia's published 2026 dependent exemption was omitted

- **Location:** `lib/tax-rules/state/flat-rate.ts`, Georgia 2026 (line 107).
- **Before:** No dependent exemption was applied because a 2026 return booklet was unavailable.
- **Correction:** Applied the enacted $5,000 per eligible dependent. At 4.99%, one additional eligible dependent reduces the modeled tax by $249.50 when there is enough taxable income. Updated review provenance and removed the false unpublished warning. No 2027 trigger-based increase is assumed.
- **Authority:** [Signed Georgia HB 463](https://gov.georgia.gov/document/2026-signed-legislation/hb-463/download), sections 2-2 and 5-1, effective for tax years beginning January 1, 2026. DOR's indexed June 2026 employer-guide search result corroborated the increase, but its download URL returned 404; the implementation therefore cites the governor's signed legislation.

## Synthetic live-result audit and further corrections

The pre-fix runs contained 86 realistic descriptors and 153 golden-corpus transactions, all synthetic, using `gpt-4.1-mini`. Provider/schema failures were zero. Category agreements were 59/69 labeled descriptors and 123/153 corpus cases, but those aggregate scores did **not** establish tax correctness. The existing expected outputs themselves approved several wrong treatments. This audit inspected all approved-deduction results (31 descriptor and 30 corpus results), then corrected the policy and affected goldens.

### 8. Formation fees were approved as current legal expenses

- **Observed:** `legalzoom` and `legalzoom-formation` approved a $299 LLC formation charge as Schedule C line 17.
- **Correction:** Formation/incorporation/organization context now requires entity, service components, active-business start date, totals and elections before a deduction. Recurring operating contract review and annual compliance remain separate.
- **Authority:** [IRS Publication 334, Legal and professional fees and business start-up costs](https://www.irs.gov/publications/p334); IRC §§195, 248, 263 and 709 depend on the entity and cost. No universal immediate formation deduction is asserted.

### 9. Office snacks and household groceries were approved as ordinary supplies

- **Observed:** `costco-mixed-with-percentage` approved 30% of a $186.33 mixed food bill as supplies solely because the user saved a 30% business share.
- **Correction:** The share does not establish legal treatment. Ask whether items were personal groceries, client meals, food for the taxpayer's own employees, food for resale or another use. The ordinary-supplies approval remains withheld until that distinction is resolved. Food-related client industries do not reclassify ordinary software subscriptions as meals. Prior confirmed personal-merchant decisions still take priority over a new business claim.
- **Authority:** [IRS Publication 463](https://www.irs.gov/publications/p463), IRC §§262 and 274. Business purpose and the statutory limitation are separate facts; certain employer-provided meals are disallowed after 2025 under §274(o).

### 10. Collected sales-tax remittances lacked incidence and gross-receipts checks

- **Observed:** `wa-dor-sales-tax-remitted` approved a $640 collected-customer-tax remittance as line 23.
- **Correction:** Ask who legally bears the tax and how receipts were recorded. Buyer-imposed tax collected and remitted is excluded from receipts and deductions. Seller-imposed tax included in gross receipts may be deductible on line 23. Sales tax on purchases follows the purchase's cost. The source packet and assistant answer now preserve this distinction. Merely naming a remittance never approves it.
- **Authority:** [Schedule C instructions, line 23](https://www.irs.gov/instructions/i1040sc). The parent agent owns the corresponding explanation paragraph.

### 11. An explicit Upwork platform service fee was placed on contractor labor

- **Observed:** `upwork-fee` approved a $47.50 platform service fee as contract labor, with prose asking for freelancer evidence.
- **Correction:** Saved notes explicitly naming Upwork/platform service fees are grounded to bank/payment/platform fees with relevant sources and fee/gross-receipts reconciliation. A payment to an actual freelance developer through Upwork remains contract labor. Merchant name alone cannot trigger this repair.
- **Authority:** [IRS Publication 334](https://www.irs.gov/publications/p334), commissions/fees and business records; [IRS Form 1099-K guidance](https://www.irs.gov/businesses/understanding-your-form-1099-k), gross payment reporting before fees. The fee must not be deducted twice from receipts already recorded net.

### 12. REALTOR association/MLS dues ignored the lobbying allocation

- **Observed:** `nar-dues-realtor-ok` approved all $195 even while asking the user to confirm that no lobbying amount was included.
- **Correction:** Require the association's nondeductible lobbying/political allocation and separate MLS charges before a deduction. Generic business-membership purpose is insufficient.
- **Authority:** [IRS Publication 334, Lobbying expenses](https://www.irs.gov/publications/p334), IRC §162(e). Dues allocable to covered lobbying/political activities are nondeductible.

### Interpreting the other disagreements

Most remaining category differences involved already unresolved expenses, explicit personal costs, or nondeductible money movements. Examples include vehicles versus travel while method facts remain missing, equipment versus supplies while asset treatment remains unresolved, and home-office organizing categories without approved deductions. Those do not establish an unsafe tax approval. Squarespace/GoDaddy hosting versus advertising was a bookkeeping-label difference for recurring operating costs. This classification does not certify every narrative or every possible transaction.

The original reports are local audit evidence only: `writeoff-ai-live-eval-descriptors-gpt-4.1-mini-1790203541935.json` and `writeoff-ai-live-eval-gpt-4.1-mini-1790203541940.json` in the system temporary directory. They predate these fixes and cannot be cited as post-fix validation.

## Other sampled rules and limits

- **Vehicles / Section 179:** The packet correctly avoids treating vehicle weight above 6,000 pounds as an automatic write-off. It asks vehicle class, qualified business use, dates, basis, elections and recapture facts. [IRS Publication 946](https://www.irs.gov/publications/p946) and IRC §§179/280F remain the relevant authorities. Unpublished 2027 indexed amounts must not be inferred from prior years.
- **Mixed use:** The transaction policy requires a recorded business-use allocation when the expense is mixed and does not invent a percentage. Transfers require their economic purpose; unidentified deposits are not automatically income.
- **Meal percentage semantics:** AI `deductible_percent` represents the proposed deductible share, including a statutory limit when supported. It is separate from the saved business-use percentage. The review service expects 50 for an approved meal suggestion but persists the category/decision, not that AI percentage; Schedule C applies the meal limit once to the recorded amount. The current grounding path withholds all meal approvals pending facts, so it produces no supported AI meal savings. An explanation for an older approved 50% result must not halve it a second time.
- **2027 HSA:** $4,500/$9,000 contributions, $1,750/$3,500 HDHP minimum deductible, $8,700/$17,400 out-of-pocket maximum; reviewed against [Rev. Proc. 2026-24](https://www.irs.gov/pub/irs-drop/rp-26-24.pdf). Eligibility, monthly coverage, employer contributions and catch-up rules remain separate.
- **2027 ACA:** The registry's six applicable-percentage bands, 400% FPL upper endpoint and 10.22% employer affordability figure agree with [Rev. Proc. 2026-26](https://www.irs.gov/pub/irs-drop/rp-26-26.pdf). The assistant explains these percentages without calculating a credit or guaranteeing eligibility.
- **2027 Saver's Match / scholarship credit:** Reviewed packets distinguish contribution year from filing year and describe eligibility, limits and unresolved implementation. They do not calculate, claim or deposit a benefit. Sources: [IRS Saver's Match](https://www.irs.gov/credits-deductions/savers-match), [Notice 2026-48](https://www.irs.gov/irb/2026-35_IRB), [IRS scholarship credit](https://www.irs.gov/government-entities/federal-state-local-governments/federal-scholarship-tax-credit-fstc), [Notice 2025-70](https://www.irs.gov/irb/2025-50_IRB).
- **Pending 2027 annual figures:** Assistant packets preserve pending status for retirement, mileage, Social Security wage base, QBI/indexed minimum, excess-business-loss and information-reporting thresholds. See `docs/research/2027-tax-readiness-2026-09-23.md` for the full publication ledger. Federal 2027 return estimates and transaction tax eligibility remain gated.

## Bounded state spotcheck

No parameter discrepancy was found in the sampled Illinois 2026 $2,925 exemption ([IDOR](https://tax.illinois.gov/questionsandanswers/answer.851.html)), North Carolina 2026 3.99% rate ([NCDOR](https://www.ncdor.gov/taxes-forms/individual-income-tax/tax-rate-schedules)), or New York 2026 rate schedules and standard deductions ([IT-2105-I](https://www.tax.ny.gov/pdf/current_forms/it/it2105i.pdf)). North Carolina warns that additional 2027 rate changes depend on triggers. New York local taxes remain separately disclosed as unmodeled. California/Ohio 2026 are explicitly unsupported in this registry; this audit did not expand them. No conclusion about all state adjustments, credits, local taxes or nonresident returns follows from this sample.

## Verification and limits

- **489 focused offline tests passed:** transaction policy (112), new live-result grounding regressions (10), golden-corpus harness (164 assertions covering 153 cases), red-team (91), taxpayer context (5), assistant topics (64), assistant guidance (43). Older expectations that inferred personal use from eating alone or rejected all federal business taxes were updated to the reviewed rules; the safety gates remain asserted.
- **18 focused state tests passed:** all state registry tests plus the Georgia calculation test; other state calculation tests were intentionally skipped in that focused rerun.
- An earlier full state-suite attempt exposed a high-income fixture now correctly hitting the core agent's QBI review gate. The core owner subsequently updated that fixture and reported all 38 state-estimate tests passing; this audit personally ran only the 18 focused state checks above.
- Synthetic regressions cover solo travel/local meals, explicit personal override, federal payroll/FUTA/highway-use and combined withholding, income-tax conflict, $200/$200.01, bulk supplies, business-loss material participation, final mixed-use loan guidance and Georgia per-dependent amounts.
- Transaction policy version advanced to `federal-transactions-2026-09-23.2`. Changed packets carry September 23 source-review provenance.
- **Targeted real-provider regression passed: 14/14 synthetic cases**, `gpt-4.1-mini`, zero provider/schema failures and zero failed assertions. It uses the real `analyzeTransaction` prompt, schema validation and server grounding, with learning/Firebase mocked. The five live-found defects are covered alongside ordinary operating-cost controls, solo overnight meals, employer payroll taxes and the $200/$200.01 boundary. This result is separate from the original 239 pre-fix cases. Sanitized mode-600 report: `/var/folders/j2/csvxynjs0h7_8c5kx1r7f6sr0000gn/T/writeoff-ai-tax-policy-targeted-gpt-4.1-mini-1790204273235.json`.
- The first targeted run returned 14 valid responses but one assertion falsely treated the correct statement about routine local meals as a denial of the separate overnight meal. The assertion was narrowed to the actual subject; the rerun passed. No provider secret was logged or saved in the report.
- This report does not certify e-filing, every legal scenario, state completeness or production deployment. Those are distinct checks and capabilities.
