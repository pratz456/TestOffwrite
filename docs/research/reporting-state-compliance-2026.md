# Information Reporting, E-file, State, Consumer-Protection, and Substantiation Research
## U.S. freelancers / self-employed, tax years 2025–2027

Research date: 2026-09-17. Scope: what a self-employed tax platform must understand (not necessarily implement) about information returns, the IRS e-file ecosystem, state/local taxes on sole proprietors, marketing/consumer-protection constraints, and audit-defense recordkeeping.

Conventions:
- Every factual claim carries a source URL. Primary sources (IRS, Treasury, state DOR, statutes, court opinions, FTC) are preferred; secondary sources are labeled.
- `UNVERIFIED` marks a claim that could not be confirmed from a primary source, or that depends on future guidance (e.g., 2027 inflation adjustments).
- `NOT RELEVANT` marks things the platform should explicitly not claim to cover.
- "OBBBA" = One Big Beautiful Bill Act, P.L. 119-21 (July 4, 2025).

---

## 1. Information reporting the platform must understand

### 1.1 Summary table (federal thresholds; payor/broker obligations, not taxpayer obligations)

| Form | What it reports | TY2025 threshold | TY2026 threshold | TY2027 | Notes |
|---|---|---|---|---|---|
| 1099-NEC | Nonemployee compensation (§6041A) | $600 | $2,000 | $2,000 indexed for inflation (`UNVERIFIED` — amount not yet published) | New boxes 1b/1c/1d for cash tips, Treasury Tipped Occupation Code, overtime starting TY2026 |
| 1099-MISC | Rents, prizes, other §6041 payments | $600 | $2,000 | Indexed (`UNVERIFIED`) | Royalties stay at $10; attorney gross proceeds stay at $600 |
| 1099-K | Payment-card and third-party-network (TPSO) payments (§6050W) | >$20,000 AND >200 transactions (TPSO); $0 for payment cards | Same | Same (no scheduled change) | OBBBA §70432 retroactive to 2022; states may set lower thresholds |
| 1099-INT / 1099-DIV | Interest / dividends | $10 or more | $10 or more | Same | Unchanged by OBBBA |
| 1099-B | Broker sales of securities (§6045) | No dollar minimum | Same | Same | Basis + wash-sale (same account, same CUSIP) for covered securities |
| 1099-DA | Digital-asset broker sales | Gross proceeds only; no basis | Gross proceeds + basis for covered digital assets | Same | Good-faith penalty relief for 2025 filings |
| W-2 | Wages | Not updated for OBBBA | New Box 12 codes TP (tips) and TT (qualified overtime); Box 14a/14b (Treasury Tipped Occupation Code) | Same | TY2025: Notice 2025-62 penalty relief |

Reminder the platform must surface to users: an information return threshold determines whether a payor/broker *files a form*; it never changes what income is taxable. IRS: "Whether or not you receive a Form 1099-K, you must still report any income on your tax return." (https://www.irs.gov/businesses/understanding-your-form-1099-k)

### 1.2 Form 1099-NEC / 1099-MISC — OBBBA §70433 raises $600 → $2,000

- OBBBA §70433 amended IRC §6041(a) and §6041A to raise the reporting (and backup-withholding) threshold from $600 to $2,000 for payments made after Dec 31, 2025, indexed for inflation beginning in calendar year 2027 (new §6041(h)).
  - IRS Publication 1099 (2026), "What's New": "For tax years beginning after 2025, the minimum threshold amount for reporting certain payments ... increased to $2,000 and will be adjusted for inflation beginning in calendar year 2027. Previously, the threshold amount was $600." https://www.irs.gov/publications/p1099
  - Instructions for Forms 1099-MISC and 1099-NEC (Rev. Dec. 2026): same, plus "New boxes 1b and 13a" (cash tips), "1c and 13b" (Treasury Tipped Occupation Code), "1d and 14" (overtime compensation) added under OBBBA §§70201–70202. https://www.irs.gov/pub/irs-prior/i1099mec--2026.pdf
  - Secondary confirmation: Littler, https://www.littler.com/news-analysis/asap/tax-bill-changes-1099-reporting-thresholds ; CPA Practice Advisor, https://www.cpapracticeadvisor.com/2025/07/30/one-big-beautiful-bill-act-changes-1099-thresholds/165863/
- Exceptions that do not move: royalties ($10), broker substitute payments ($10), gross proceeds to attorneys ($600), fish purchases for cash ($600) — see Pub 1099 (2026) "Guide to Information Returns." https://www.irs.gov/pub/irs-pdf/p1099.pdf
- Payors may still voluntarily issue a 1099-NEC below $2,000. The platform should not tell users "you won't get a 1099 if under $2,000."
- TY2027 dollar amount: `UNVERIFIED` — the IRS had not published the first inflation-adjusted figure as of research date.
- State conformity to $2,000: `UNVERIFIED` — one secondary source states California adopted $2,000 for TY2026 while Mississippi and Wisconsin remain at $600 (https://cpavalidated.com/1099-thresholds-2026-obbba-matrix.html). Confirm against each state DOR before asserting.

### 1.3 Form 1099-K — OBBBA §70432 reverts TPSO threshold to >$20,000 AND >200 transactions

- IRS IR-2025-107 (Oct 23, 2025) and Fact Sheet 2025-08: "The OBBB retroactively reinstated the reporting threshold in effect prior to the passage of the American Rescue Plan Act of 2021 (ARPA) so that third party settlement organizations are not required to file Forms 1099-K unless the gross amount of reportable payment transactions to a payee exceeds $20,000 and the number of transactions exceeds 200." https://www.irs.gov/newsroom/irs-issues-faqs-on-form-1099-k-threshold-under-the-one-big-beautiful-bill-dollar-limit-reverts-to-20000
- IRS 1099-K FAQs (updated Oct 23, 2025): both conditions must be met; payment-card transactions have no de minimis threshold; a TPSO may still send a form below threshold; states may have lower thresholds. https://www.irs.gov/newsroom/form-1099-k-faqs-general-information
- Retroactivity: §70432(a) applies "as if included in section 9674 of the American Rescue Plan Act" (i.e., 2022 forward). Backup-withholding rule alignment effective for calendar years after 2024. RSM analysis: https://rsmus.com/insights/tax-alerts/2025/tips-navigating-obbba-new-changes-us-tax-reporting-withholding-rules.html ; Pub 1099 (2026) "Form 1099-K backup withholding for calendar years beginning after 2024": https://www.irs.gov/pub/irs-pdf/p1099.pdf
- This replaces the IRS's Notice 2024-85 phase-in ($5,000 for 2024; planned $2,500 for 2025; $600 for 2026), which is now moot.
- State 1099-K thresholds lower than federal (platform must expect users in these states to receive 1099-Ks well below $20k):
  - $600, no transaction minimum: Maryland, Massachusetts, Vermont, Virginia, District of Columbia; Montana (`UNVERIFIED` — secondary only).
  - Illinois: $1,000 and ≥4 transactions. New Jersey: $1,000. Missouri: $1,200 (`UNVERIFIED` — secondary only). Arkansas: $2,500 when no state withholding. Rhode Island: $100 for all 1099s from TY2025 (RI ADV 2026-05, `UNVERIFIED` — cited by secondary source only).
  - Sources: Stripe state table https://docs.stripe.com/connect/1099-k ; RSM https://rsmus.com/insights/services/business-tax/irs-updates-obbba-new-reporting-thresholds.html ; secondary compilation https://gigtaxguide.com/guides/1099-k-threshold-by-state . Verify each against the state DOR before hard-coding.

### 1.4 Form 1099-INT / 1099-DIV / 1099-B (from banks and brokers)

- 1099-INT and 1099-DIV: $10 or more (unchanged by OBBBA). Pub 1099 (2026) Guide to Information Returns. https://www.irs.gov/pub/irs-pdf/p1099.pdf
- 1099-B (IRC §6045): brokers report gross proceeds for every sale; for **covered securities** they must also report adjusted basis (box 1e), acquisition date (1b), short/long-term (2), accrued market discount (1f), and wash-sale loss disallowed (1g). Instructions for Form 1099-B (2026): https://www.irs.gov/instructions/i1099b ; statute: https://uscode.house.gov/view.xhtml?req=granuleid%3AUSC-prelim-title26-section6045&num=0&edition=prelim
- Covered-security phase-in dates (stock acquired ≥2011; mutual funds/DRIP ≥2012; less-complex debt and options ≥2014; complex debt ≥2016) — Instructions for Form 1099-B; secondary summary https://boomtax.com/tax-forms/1099-b-cost-basis .
- **Wash sales**: brokers are required to report disallowed loss only when the sale and repurchase occur "in the same account with respect to covered securities with the same CUSIP number." IRC §6045(g)(2)(B)(ii); Instructions for Form 1099-B. The taxpayer's §1091 obligation is broader: substantially identical securities, across accounts (including IRAs and spouse accounts). A tax app that ingests 1099-Bs must not represent broker-reported 1g as the complete wash-sale adjustment.
- Digital assets on Form 1099-S: beginning TY2026, digital assets used in real-estate closings are reported on 1099-S. Pub 1099 (2026). https://www.irs.gov/pub/irs-pdf/p1099.pdf

### 1.5 Form 1099-DA — digital-asset broker reporting (T.D. 10000)

- Final regulations (T.D. 10000, published July 9, 2024) require brokers to report on Form 1099-DA:
  - Gross proceeds for dispositions on or after Jan 1, 2025.
  - Basis for "covered" digital assets for dispositions on or after Jan 1, 2026 (generally assets acquired after 2025 in the broker's custodial account and held there until sale).
  - Real-estate reporting persons must report FMV of digital assets paid in real-estate transactions closing on/after Jan 1, 2026.
  - Source: IRS, "Final regulations and related IRS guidance for reporting by brokers on sales and exchanges of digital assets." https://www.irs.gov/newsroom/final-regulations-and-related-irs-guidance-for-reporting-by-brokers-on-sales-and-exchanges-of-digital-assets
- 2025 Instructions for Form 1099-DA: "Brokers are not required to report basis information with respect to sales effected in 2025." https://www.irs.gov/pub/irs-prior/i1099da--2025.pdf
- 2026 Instructions for Form 1099-DA: mandatory gross proceeds for all digital assets; mandatory basis for covered securities; voluntary basis for noncovered (box 9 checked); optional simplified reporting for qualifying stablecoins and specified NFTs; proceeds in box 1f, basis in box 1g. https://www.irs.gov/instructions/i1099da
- Transitional relief: for CY2025 transactions reported in 2026, no §6721/6722 penalties if the broker makes a good-faith effort (Notice 2024-56); backup-withholding relief (Notice 2024-57); Rev. Proc. 2024-28 allows taxpayers to allocate unused basis to wallets/accounts as of Jan 1, 2025 (per-wallet/account basis identification replaces universal pooling). Summarized at the IRS newsroom link above.
- Non-custodial ("DeFi") broker rule: the separate December 2024 final rule extending broker status to certain DeFi front-end providers was repealed by Congress under the Congressional Review Act in 2025 (`UNVERIFIED` in this research — not independently re-sourced here; confirm before relying).
- Platform implication: for TY2025, users will receive 1099-DAs with proceeds but usually no basis; the user must supply basis. For TY2026+, basis will appear only for covered lots; transferred-in lots will typically be noncovered.

### 1.6 Form W-2 (TY2026) — new codes for tips and overtime (OBBBA §§70201–70202)

- TY2026 W-2 (https://www.irs.gov/pub/irs-pdf/fw2.pdf) and 2026 General Instructions for Forms W-2 and W-3 (https://www.irs.gov/instructions/iw2w3):
  - Box 12 code **TP** — total cash tips reported to the employer (used for the qualified-tip deduction, Schedule 1-A Part II).
  - Box 12 code **TT** — total qualified overtime compensation (the FLSA §7 premium "half" portion, not total OT wages), used for Schedule 1-A Part III.
  - Box 12 code **TA** — employer Trump Account contributions (§128).
  - Box 14 split into **14a** (Other) and **14b** (Treasury Tipped Occupation Code(s), up to two). Code 000 alone = tips are not qualified tips.
  - Box 9 shrunk to make room.
- Deduction parameters (for context): qualified tips up to $25,000; qualified overtime up to $12,500 ($25,000 MFJ); tax years 2025–2028; both available to self-employed individuals (tips) subject to limits. 2026 W-2/W-3 instructions, above.
- TY2025 transition: IRS did not update 2025 W-2/1099 forms. Notice 2025-62 waives §6721/6722 penalties for 2025 returns that omit the separate tip/occupation/overtime accounting, provided the return is otherwise complete and correct; employers are encouraged to furnish the data via Box 14, portals, or separate statements. https://www.irs.gov/pub/irs-drop/n-25-62.pdf ; IR-2025-110 https://www.irs.gov/newsroom/treasury-irs-provide-penalty-relief-for-tax-year-2025-for-information-reporting-on-tips-and-overtime-under-the-one-big-beautiful-bill
- Self-employed relevance: 1099-NEC/1099-MISC get parallel tip and overtime boxes for TY2026 (see 1.2). For TY2025, a self-employed user claiming the tip deduction may have to reconstruct qualified tips from their own records or Form 4137-type reporting because payors were not required to break them out.

### 1.7 What SEC / FINRA actually govern — and what is NOT relevant to a tax app

- **SEC** registers and regulates broker-dealers under Exchange Act §15 (and investment advisers, exchanges, issuers). https://www.sec.gov/about/divisions-offices/division-trading-markets/division-trading-markets-compliance-guides/guide-broker-dealer-registration
- **FINRA** is a private self-regulatory organization, supervised by the SEC, that licenses and examines broker-dealer firms and their registered representatives. It does not regulate investment advisers that are not broker-dealers, issuers, or individual taxpayers. (Secondary summary: https://legalclarity.org/finra-vs-sec-powers-scope-and-how-they-relate/ ; FINRA membership requirement stated in SEC guide above.)
- **Neither SEC nor FINRA sets any tax rule.** Cost-basis reporting, wash sales, holding periods, 1099-B/1099-DA content, and their due dates are governed exclusively by the Internal Revenue Code (§§6045, 6045A, 6045B, 1091, 1012, 1222) and Treasury regulations.
- What IS relevant to a freelancer tax app from the brokerage world:
  - Ingesting 1099-B and 1099-DA (proceeds, basis, wash-sale adjustments, covered/noncovered flag) into Form 8949 / Schedule D.
  - Applying §1091 wash-sale rules across accounts where the broker did not.
  - Basis for noncovered lots (user-supplied).
  - Consolidated 1099 statements often arrive Feb 15 (not Jan 31) and are frequently corrected in March; the app should not prompt early filing on preliminary brokerage data. (Pub 1099 due-date table: 1099-B furnish date Feb 15. https://www.irs.gov/pub/irs-pdf/p1099.pdf)
- `NOT RELEVANT` — do not claim or imply:
  - "SEC-compliant" or "FINRA-compliant" tax calculations (no such thing exists for a tax app).
  - Registration with SEC/FINRA (a tax app that does not effect securities transactions or give investment advice for compensation has no SEC/FINRA registration obligation; if the product ever gives individualized investment advice, that is an Investment Advisers Act question, out of scope here).
  - Pattern-day-trader rules, margin rules, suitability, Reg BI, trader-tax-status (§475 mark-to-market) determinations — the last is a tax election but far outside a freelancer product's scope.
  - Trade confirmations, monthly statements, or SIPC coverage as "tax records" — they are supporting evidence at most.

---

## 2. IRS e-file ecosystem (as of processing year 2026)

### 2.1 Roles and vocabulary

- **Authorized IRS e-file Provider**: a firm that submits an e-file application, passes suitability, and receives an **EFIN** (Electronic Filing Identification Number). Roles (not mutually exclusive): Electronic Return Originator (ERO), Intermediate Service Provider, Transmitter, Software Developer, Reporting Agent, **Online Provider**, Large Taxpayer. Publication 3112 (Rev. 11-2025). https://www.irs.gov/pub/irs-pdf/p3112.pdf
- **ERO**: originates the electronic submission of a return (typically the preparer or the DIY software company's filing entity).
- **Online Provider**: an ERO/Transmitter that lets taxpayers self-prepare and e-file over the internet — this is the role a DIY app occupies. Pub 1345 imposes additional Online Provider standards (EV SSL/TLS 1.2+, weekly PCI-ASV external vulnerability scans, information-privacy statement, reporting of security incidents, MFA for taxpayer accounts). Publication 1345 (Rev. 12-2025). https://www.irs.gov/pub/irs-pdf/p1345.pdf
- **Software Developer**: writes software that formats returns to MeF XML schemas; must pass Assurance Testing System (ATS) every year for each form family.
- **Transmitter**: sends returns to the IRS via MeF; receives an **ETIN** (Electronic Transmitter Identification Number); one-time communications test.
- **MeF (Modernized e-File)**: the IRS's XML/web-services filing platform. Software developers use IRS-provided WSDLs (R10.9 for PY2026, installed in ATS Oct 14, 2025) delivered via the e-Services Secure Object Repository; SHA-1 signatures are rejected (SHA-256+ required). https://www.irs.gov/e-file-providers/modernized-e-file-mef-status ; Publication 4164 (Rev. 12-2025) https://www.irs.gov/pub/irs-pdf/p4164.pdf ; Publication 1436 (1040 ATS) https://www.irs.gov/pub/irs-pdf/p1436.pdf

### 2.2 Becoming an Authorized IRS e-file Provider (ERO / Online Provider / Software Developer)

Steps (IRS, "Become an authorized e-file provider," and Pub 3112):
1. Each Principal and Responsible Official creates an IRS e-Services account (ID.me identity verification).
2. Firm submits the e-file application: firm identification, each Principal/Responsible Official, provider option(s) (ERO, Transmitter, Software Developer, Online Provider, etc.), form types.
3. Each Principal/Responsible Official either enters professional credentials (attorney, CPA, EA, certain bank/corporate officials) or is fingerprinted via the IRS-authorized Livescan vendor (no charge), and signs the Terms of Agreement.
4. IRS suitability check: tax compliance, credit, criminal background, prior e-file non-compliance. Up to ~45 days. No application fee.
5. Acceptance letter with EFIN. Software Developers/Transmitters also receive ETIN(s) and must complete ATS/communications testing before production.
- Sources: https://www.irs.gov/e-file-providers/become-an-authorized-e-file-provider ; https://www.irs.gov/pub/irs-pdf/p3112.pdf ; IRS Tax Tip https://www.stayexempt.irs.gov/newsroom/tax-pros-become-an-authorized-e-file-provider-in-three-steps ; IRM 3.42.10 https://www.taxnotes.com/research/federal/internal-revenue-manual/3.42.10
- Ongoing: annual ATS for developers; Pub 1345 rules on advertising ("Authorized IRS e-file Provider" logo usage; no misleading refund-timing claims), record retention, security; EFIN activity monitoring; sanctions for non-compliance. https://www.irs.gov/pub/irs-pdf/p1345.pdf
- Note: the IRS "e-file Provider" application is separate from the **PTIN** (needed only by paid preparers who sign returns) and from Free File Alliance membership.

### 2.3 Form 8879 / signature rules

- Taxpayers sign 1040 e-file returns with a PIN: **Self-Select PIN** (taxpayer enters own PIN; authenticated by prior-year AGI or prior-year PIN — this is the DIY/Online Provider path) or **Practitioner PIN** (ERO-assisted; requires Form 8879). Pub 1345. https://www.irs.gov/pub/irs-pdf/p1345.pdf
- **Form 8879** is required when the Practitioner PIN method is used or when the ERO enters/generates the taxpayer's PIN. The ERO must receive the signed 8879 before transmitting; it is not sent to the IRS; retain 3 years from the return due date or IRS received date, whichever is later; may be retained electronically under Rev. Proc. 97-22. About Form 8879 (page updated Mar 30, 2026) https://www.irs.gov/forms-pubs/about-form-8879 ; form instructions https://www.irs.gov/pub/irs-pdf/f8879.pdf
- **E-signature on 8878/8879**: permitted if the ERO's software performs identity verification (KBA; disable after 3 failed attempts → handwritten signature) and records: digital image of signed form, date/time, taxpayer IP address and login (remote), ID-verification result, e-signature method. Tamper-proof, access-controlled storage for 3 years. IRS FAQ https://www.irs.gov/e-file-providers/frequently-asked-questions-for-irs-efile-signature-authorization ; Pub 1345 §"Electronic Signature Guidance for Forms 8878 and 8879."
- Practical split: a pure DIY Online Provider flow (taxpayer self-selects PIN and clicks "file") does not use Form 8879; an "expert files for you" flow does.

### 2.4 Free File / Direct File status (2026)

- **IRS Direct File** was shut down after Filing Season 2025 and was not offered in Filing Season 2026; "No launch date has been set for the future." AP: https://apnews.com/article/irs-direct-file-not-available-2026-04f2d0c31bec80b55d122a0e76e08c36 ; Accounting Today: https://www.accountingtoday.com/news/irs-ends-direct-file-program
- **IRS Free File** (public-private, Free File Alliance) continued for FS2026 with 8 trusted partners, AGI ≤ $89,000 (TY2025); Free File Fillable Forms at any income. https://www.irs.gov/newsroom/2026-tax-filing-season-opens-with-several-free-filing-options-available ; https://www.irs.gov/newsroom/irs-free-file-supports-even-more-complex-returns
- Implication for a freelancer app: no government-run alternative competes for Schedule C filers; Free File partners set their own eligibility and some exclude Schedule C or state returns.

### 2.5 Embedded / white-label filing providers (build vs. partner)

- **Column Tax** — embedded federal + state DIY filing API (had processed 1M+ returns). **Acquired by Aiwyn in December 2025**; now marketed as "Aiwyn Tax (formerly Column Tax)." Aiwyn's public 2026 emphasis is a 1040 pilot for accounting firms and a Claude Connector for calculations (explicitly "does not file or e-file returns"). Whether the embedded consumer API remains open to new fintech partners is `UNVERIFIED` — no updated partner roster or pricing was found. Sources: https://www.columntax.com/blog/column-tax-joins-aiwyn ; https://www.prnewswire.com/news-releases/aiwyn-seeks-100-firms-for-groundbreaking-tax-pilot-following-column-tax-acquisition-302642515.html ; https://www.aiwyn.ai/resources/articles/aiwyn-claude-helping-firms-navigate-the-ai-future-of-tax/ ; https://www.prnewswire.com/news-releases/aiwyn-joins-anthropics-claude-connector-ecosystem-providing-verified-tax-calculation-infrastructure-302740511.html
- **april** (getapril.com) — IRS-authorized ERO + Transmitter + Software Developer; claims e-file coverage in all 50 jurisdictions; API or hosted-URL embed; optional credentialed-pro assistance; 30+ live partners (Chime, Gusto, Esusu, Compound, Wavvest, ZenBusiness); is Hurdlr's filing partner. Guarantees: fee refund for calc error, up to $10,000 penalty/interest reimbursement for software math error, "informational" audit assistance only (no representation). Sources: https://www.getapril.com/resources/Blog/april-becomes-the-first-nationally-licensed-efile-provider-built-to-be-embedded-jDtPzHGQ3V9QXWW9Rmr3fb ; https://www.getapril.com/resources/Blog/aprils-triple-threat-tax-filing-service-why-it-matters-n5CVBsR64iqd1Yy9R5a9ze ; https://www.getapril.com/for-developers-old ; https://www.getapril.com/smb-and-gig-platforms ; https://university.hurdlr.com/en/articles/8767110-is-there-audit-protection-support
- Other embedded/white-label vendors (e.g., TaxAct/TaxSlayer/Drake white-label programs, Intuit's platform partnerships): `UNVERIFIED` — not researched here.
- High-level requirements to embed rather than build: the embedded provider holds the EFIN/ETIN and is the ERO/Online Provider; the host app is typically an "auxiliary service" provider and is therefore itself a "tax return preparer" for **§7216** privacy purposes (see §4.3), must not represent that it is the e-file provider, and must comply with Pub 1345 advertising rules if it uses IRS e-file branding.
- Build path summary: EFIN + ETIN application (~45+ days), annual 1040 ATS scenarios (Pub 1436), MeF A2A integration (Pub 4164), per-state e-file approvals (each state has its own MeF Fed/State program and testing), Pub 1345 Online Provider security standards, FTC Safeguards Rule WISP (see §4.4). April describes itself as "the first new company in over 15 years" to achieve nationwide coverage — a signal of the effort involved.

---

## 3. State income-tax landscape for sole proprietors

### 3.1 States with no individual income tax (TY2025–2026)

Alaska, Florida, Nevada, New Hampshire, South Dakota, Tennessee, Texas, Wyoming — no individual income tax at all. Washington — no tax on wages/self-employment income through 2027, but:
- WA taxes long-term capital gains (7%; 9.9% above $1M from TY2025) — https://www.taxesforexpats.com/articles/tax-saving-strategies/states-without-income-tax.html (secondary) — and
- WA SB 6346 (signed Mar 30, 2026) enacts a **9.9% individual income tax beginning Jan 1, 2028** with a $1,000,000 standard deduction; litigation risk noted. EY: https://taxnews.ey.com/news/2026-0852-washington-to-implement-individual-income-tax-regime-beginning-in-2028-featuring-1-million-standard-deduction (secondary; primary bill text `UNVERIFIED` here).
- New Hampshire repealed its Interest & Dividends Tax effective for tax periods beginning on/after Jan 1, 2025. NH DRA: https://www.revenue.nh.gov/news-and-media/repeal-nh-interest-and-dividends-tax-now-effect
- Tennessee's Hall tax ended 2021. Mississippi is **not** a no-tax state (4% flat in 2026; further cuts are trigger-based). Secondary: https://www.countrytaxcalc.com/tax-guides/usa/mississippi-income-tax-guide-2026/ (`UNVERIFIED` against MS DOR).

### 3.2 Separate gross-receipts / business taxes that hit sole proprietors even with no (or low) income tax

| Jurisdiction | Tax | Who/when | Rate | Source |
|---|---|---|---|---|
| Washington | Business & Occupation (B&O) tax on gross receipts | All businesses incl. sole props; annual filing threshold $125,000 → **$250,000 effective July 1, 2026** (SB 6346) | Service & other activities: 1.5% (<$1M prior-year), 1.75% (≥$1M), **2.1% if ≥$5M** (HB 2081, implemented Jan 1, 2026); retailing 0.471%→0.5% and wholesaling 0.484%→0.5% on Jan 1, 2027. Small-business credit rises to $375/mo (service) / $125/mo (other) July 1, 2026 | WA fiscal note https://fnspublic.ofm.wa.gov/FNSPublicSearch/GetPDF?packageID=74991 ; HB 2081 https://lawfilesext.leg.wa.gov/biennium/2025-26/Pdf/Bills/Session%20Laws/House/2081-S.sl.pdf ; EY on SB 6346 https://taxnews.ey.com/news/2026-0853-washington-enacts-sales-and-use-tax-and-business-and-occupation-tax-changes-and-clarifications-including-future-tax-relief |
| New York City | Unincorporated Business Tax (UBT) | Sole props/SMLLCs with total gross business income > $95,000 must file (NYC-202S/202) | 4% of taxable income after $5,000 exemption and allowance for taxpayer services (lesser of 20% or $10,000); full credit if tax ≤ $3,400, partial to $5,400; NYC residents get partial PIT credit for UBT paid | https://nyc.gov/site/finance/business/business-unincorporated-business-tax-ubt.page ; NYC-202 instructions 2025 https://www.nyc.gov/assets/finance/downloads/pdf/25pdf/business_tax_forms/nyc-202-instr_2025.pdf |
| NY MCTD (NYC + 7 suburban counties) | MCTMT on net earnings from self-employment | TY2025: NESE allocated to a zone > $50,000; **TY2026: > $150,000** (tested per zone, per individual) | Zone 1 (NYC) 0.60%; Zone 2 0.34% of all allocated NESE once threshold exceeded | https://www.tax.ny.gov/bus/mctmt/selfemp.htm ; 2025 tables https://www.tax.ny.gov/pit/file/tax-tables/2025.htm ; 2026 IT-2105 instructions https://www.tax.ny.gov/pdf/current%5Fforms/it/it2105i.pdf |
| Portland, OR / Multnomah County | Portland Business License Tax; Multnomah Business Income Tax | Sole props must file even if exempt. Portland exemption: gross receipts < $50,000 (TY≤2025), **< $75,000 (TY2026)**, < $100,000 (TY2027+). Multnomah exemption: < $100,000 | Portland 2.6% of net income (min $100); Multnomah 2.0% (min $100). Sole props are NOT subject to Metro SHS *business* tax but ARE subject to Metro SHS personal tax (1% over $125k/$200k; **$128k/$205k for 2026**) and Multnomah Preschool for All personal tax (1.5% over $125k/$200k, +1.5% over $250k/$400k; +0.8% in 2027) | https://www.portland.gov/revenue/business-tax ; https://www.portland.gov/revenue/sp2025instructions ; https://www.portland.gov/revenue/personal-tax |
| Ohio | Commercial Activity Tax (CAT) | Applies to all entity types incl. sole props, but only if Ohio taxable gross receipts **> $6,000,000** (2025+); annual minimum tax eliminated 2024 | 0.26% of receipts over $6M; quarterly filing | https://tax.ohio.gov/business/commercial-activity-tax ; 2026 Ohio Small Business Tax Guide https://dam.assets.ohio.gov/image/upload/tax.ohio.gov/documents/Small_Business_Tax_Guide_2026.pdf (most freelancers: irrelevant; do not show CAT to users under $6M) |
| Philadelphia, PA | Net Profits Tax (NPT) + Business Income & Receipts Tax (BIRT) | Sole props: residents on all net profits; nonresidents on Philadelphia activity. **$100,000 BIRT gross-receipts exemption ended TY2025** — everyone files | NPT TY2025: 3.74% resident / 3.43% nonresident. BIRT TY2025: 1.410 mills on gross receipts + 5.71% on net income; 60% of BIRT net-income portion creditable against NPT | https://www.phila.gov/services/payments-assistance-taxes/taxes/business-taxes/business-taxes-by-type/net-profits-tax/ ; https://www.phila.gov/services/payments-assistance-taxes/taxes/business-taxes/business-taxes-by-type/business-income-receipts-tax-birt/ ; https://www.phila.gov/2025-07-22-key-philadelphia-tax-policy-changes-you-need-to-know-now/ |
| Pennsylvania (statewide) | Local Earned Income Tax (Act 32) on wages **and net profits** | Every PA municipality/school district; typically ~1% (Philadelphia excepted, above) | Varies by locality | PA DCED (referenced in https://legalclarity.org/pa-tax-brackets-flat-3-07-rate-and-local-income-taxes/ — secondary; `UNVERIFIED` rate ranges) |
| Texas | Franchise (margin) tax | Sole proprietorships NOT taxable entities; **single-member LLCs ARE** (even if disregarded federally), though most owe $0 below the no-tax-due threshold and file only an information report | 0.375%/0.75% of margin above threshold | https://comptroller.texas.gov/taxes/franchise/faq/taxable-entities.php ; https://comptroller.texas.gov/taxes/publications/98-806.php |
| Ohio / Kentucky / Michigan / Indiana / Maryland municipalities and counties | Local income taxes on net profits (e.g., Columbus 2.5%, RITA/CCA municipalities; KY occupational license taxes; MD county piggyback rates) | Sole props generally must file a municipal net-profit return where they work/reside | Varies | `UNVERIFIED` in this pass — flagged as a known category; source each locality individually |
| San Francisco | Gross Receipts Tax | Small-business exemption ~$2.25M+ gross receipts (indexed); most freelancers exempt but must still register | Varies | `UNVERIFIED` — not sourced in this pass |

### 3.3 States with materially different standard deductions / brackets vs. federal (why a federal-only estimate misleads)

Where the state's own base differs from federal taxable income, using a "federal effective rate × state rate" shortcut or assuming the federal standard deduction (2025: $15,750 single / $31,500 MFJ under OBBBA) produces large errors:

- **Pennsylvania**: flat 3.07%; **no standard deduction, no personal exemption**; eight income classes with no cross-class loss netting (a Schedule C loss cannot offset W-2 wages). https://www.pa.gov/agencies/revenue/resources/tax-types-and-information/personal-income-tax ; https://www.pa.gov/agencies/revenue/resources/tax-rates
- **Illinois**: flat 4.95%; **no standard deduction**, only a personal exemption ($2,850 TY2025; $2,925 TY2026; zero if federal AGI > $250k single / $500k MFJ). https://tax.illinois.gov/questionsandanswers/answer.851.html ; https://tax.illinois.gov/content/dam/soi/en/web/tax/forms/incometax/documents/currentyear/individual/il-1040-instr.pdf
- **California**: standard deduction $5,706 single / $11,412 MFJ-HOH (TY2025) — about one-third of federal; 1%–12.3% brackets plus 1% Mental Health Services Tax over $1M (`UNVERIFIED` here); does not conform to many federal OBBBA items. https://www.ftb.ca.gov/file/personal/deductions/index.html ; https://www.ftb.ca.gov/forms/2025/2025-540-instructions.html
- **New York**: standard deduction $8,000 single / $16,050 MFJ / $11,200 HOH; $1,000 dependent exemption; 4%–10.9% with a "tax benefit recapture" computation above $107,650 NYAGI; NYC resident PIT 3.078%–3.876% on top. https://www.tax.ny.gov/forms/current-forms/it/it201i.htm
- **Ohio**: **Business Income Deduction** — first $250,000 ($125,000 MFS) of Schedule C / pass-through business income is fully deductible and the excess is taxed at a flat 3%; nonbusiness income: 0% up to $26,050, 2.75% to $100k, 3.125% above (TY2025); flat 2.75% above $26,050 for TY2026 (HB 96). This alone makes a federal-only or generic-state estimate wildly wrong for Ohio freelancers (most owe near-zero Ohio tax on business income). https://tax.ohio.gov/individual/resources/businessincomededuction ; https://tax.ohio.gov/individual/file-now/annual-tax-rates ; HB 96 analysis https://www.lsc.ohio.gov/assets/legislation/136/hb96/ps/files/hb96-tax-bill-analysis-as-passed-by-the-senate-136th-general-assembly.pdf
- **Georgia**: flat 5.19% (TY2025) → **4.99% retroactive to Jan 1, 2026 (HB 463)**; standard deduction $12,000/$24,000 (TY2025) → **$15,000/$30,000 (TY2026)**; further 0.125-pt annual cuts toward 3.99% are revenue-triggered; GA adopts OBBBA tip/overtime exclusions from 2026. https://dor.georgia.gov/taxes/important-tax-updates ; https://gov.georgia.gov/press-releases/2026-05-11/gov-kemp-signs-legislation-lowering-taxes-and-supporting-economic-growth ; HB 111 text https://gov.georgia.gov/document/2025-signed-legislation/hb-111/download
- **North Carolina**: flat 4.25% (TY2025) → 3.99% (TY2026+), with revenue triggers that could cut 0.5 pt/yr from 2027 (floor 2.49%); NC standard deduction $12,750 / $25,500 / $19,125 HOH; no local income taxes. https://www.ncdor.gov/taxes-forms/individual-income-tax/tax-rate-schedules ; G.S. 105-153.7 https://www.ncleg.gov/EnactedLegislation/Statutes/PDF/BySection/Chapter_105/GS_105-153.7.pdf
- Where a **federal-only estimate is most misleading**, ranked for a Schedule C filer:
  1. Ohio (BID makes state tax on business income ≈ 0 up to $250k).
  2. NYC residents (state + city PIT + UBT + MCTMT stack to ~15%+ marginal before federal).
  3. Philadelphia residents (NPT 3.74% + BIRT + PA 3.07%, no deductions).
  4. Portland/Multnomah (2.6% + 2.0% business taxes + up to 3%+ personal surtaxes on top of Oregon 9.9%).
  5. Washington (zero income tax but B&O on gross receipts — tax owed even in a loss year).
  6. Pennsylvania/Illinois (flat rate from dollar one; no standard deduction).
  7. California (very low standard deduction, very high top rates, no QBI-style deduction).
  8. Any state that does not conform to the federal QBI deduction (§199A) — most states start from federal AGI, so §199A (a below-the-line deduction) never reduces state taxable income anyway; the app must not apply the 20% QBI deduction to state estimates.

### 3.4 State bracket / rate source links — top 10 freelancer states

Provide these as the canonical links to consult each year (do not transcribe brackets here):

| State | TY2025 / TY2026 rate structure | Official source |
|---|---|---|
| CA | Graduated 1%–12.3% (+1% MHST >$1M); std ded $5,706/$11,412 (2025) | FTB tax rates & tables: https://www.ftb.ca.gov/forms/2025/2025-540-instructions.html ; https://www.ftb.ca.gov/file/personal/deductions/index.html ; calculator https://www.ftb.ca.gov/tax-rates |
| NY | Graduated 4%–10.9%; NYC 3.078%–3.876%; MCTMT | IT-201 instructions (rate schedule pp. 33–40): https://www.tax.ny.gov/forms/current-forms/it/it201i.htm ; 2025 tables https://www.tax.ny.gov/pit/file/tax-tables/2025.htm ; MCTMT https://www.tax.ny.gov/bus/mctmt/selfemp.htm |
| TX | No individual income tax; franchise tax exempts sole props | https://comptroller.texas.gov/taxes/publications/98-806.php |
| FL | No individual income tax | Florida DOR tax types: https://floridarevenue.com/taxes/taxesfees/Pages/default.aspx (`UNVERIFIED` exact page; FL has no PIT statute to link) |
| IL | Flat 4.95%; exemption $2,850 (2025) / $2,925 (2026) | https://tax.illinois.gov/questionsandanswers/answer.851.html ; IL-1040 instructions https://tax.illinois.gov/content/dam/soi/en/web/tax/forms/incometax/documents/currentyear/individual/il-1040-instr.pdf |
| PA | Flat 3.07%; no std ded; local EIT; Philadelphia NPT/BIRT | https://www.pa.gov/agencies/revenue/resources/tax-rates ; https://www.pa.gov/agencies/revenue/resources/tax-types-and-information/personal-income-tax ; Philadelphia https://www.phila.gov/services/payments-assistance-taxes/taxes/business-taxes/business-taxes-by-type/net-profits-tax/ |
| OH | Nonbusiness: 0%/2.75%/3.125% (2025), flat 2.75% >$26,050 (2026); business income: $250k BID then 3%; municipal taxes; CAT >$6M | https://tax.ohio.gov/individual/file-now/annual-tax-rates ; https://tax.ohio.gov/individual/resources/businessincomededuction ; 2025 IT 1040 booklet https://dam.assets.ohio.gov/image/upload/tax.ohio.gov/forms/ohio_individual/individual/2025/it1040-booklet.pdf |
| GA | Flat 5.19% (2025) / 4.99% (2026); std ded $12k/$24k → $15k/$30k | https://dor.georgia.gov/taxes/important-tax-updates ; GA DOR individual taxes https://dor.georgia.gov/taxes/individual-taxes |
| NC | Flat 4.25% (2025) / 3.99% (2026); std ded $12,750/$25,500 | https://www.ncdor.gov/taxes-forms/individual-income-tax/tax-rate-schedules |
| WA | No income tax (through 2027); B&O gross receipts tax; capital gains tax; 9.9% income tax from 2028 | WA DOR B&O: https://dor.wa.gov/taxes-rates/business-occupation-tax (`UNVERIFIED` exact URL; rates confirmed via legislative sources above) ; HB 2081 https://lawfilesext.leg.wa.gov/biennium/2025-26/Pdf/Bills/Session%20Laws/House/2081-S.sl.pdf |

Cross-state secondary reference (useful for a yearly diff, not as the source of record): Tax Foundation, "2026 State Income Tax Rates and Brackets." https://taxfoundation.org/data/all/state/state-income-tax-rates-2026/

---

## 4. Consumer-protection issues for tax-software marketing and guidance

### 4.1 FTC v. Intuit (TurboTax "free") — 2022–2026

- Jan 19, 2024: FTC Commission Opinion and Final Order (Docket 9408) found Intuit's "free" TurboTax ads deceptive under FTC Act §5 (about two-thirds of taxpayers were ineligible). Order: may not advertise anything as "free" unless free for all consumers, or clearly and conspicuously disclose the percentage who qualify (or that a majority do not) and all material terms; 20-year term. https://www.ftc.gov/news-events/news/press-releases/2024/01/ftc-issues-opinion-finding-turbotax-maker-intuit-inc-engaged-deceptive-practices ; Opinion https://www.ftc.gov/system/files/ftc_gov/pdf/d09408_commission_opinion_redacted_public.pdf ; Order https://www.ftc.gov/system/files/ftc_gov/pdf/d09408_commission_final_order.pdf
- **Mar 20, 2026: Fifth Circuit vacated the FTC order** (No. 24-60040), holding under *SEC v. Jarkesy* that deceptive-advertising claims of this kind must be adjudicated in an Article III court, not by an FTC ALJ; remanded, did not order dismissal, and expressly did not decide whether the ads were deceptive. https://www.ca5.uscourts.gov/opinions/pub/24/24-60040-CV0.pdf ; Reuters https://www.reuters.com/world/us-appeals-court-tosses-ftc-order-against-intuit-over-turbotax-advertising-2026-03-20/
- The FTC's *substantive* standard for "free" claims (16 CFR Part 251 Guide Concerning Use of the Word "Free"; §5 deception) is unaffected by the procedural ruling. Whether the FTC re-files in federal court: `UNVERIFIED` as of research date.
- Separate: 2022 multistate AG settlement, Intuit paid $141M restitution for "free" claims (`UNVERIFIED` here — widely reported, not re-sourced in this pass).

### 4.2 FTC v. H&R Block — 2024–2025 order binding for 2025 and 2026 seasons

- Feb 2024 complaint; Nov 2024 proposed consent; **Jan 8, 2025 final Decision and Order**: $7,000,000; must allow downgrade via automated means (by Feb 15, 2025); by the 2026 season must stop deleting previously entered data on downgrade and return users to the same point; "free" ads must disclose the percentage eligible or that a majority do not qualify; broad prohibition on misrepresenting price, total cost, refund policy, restrictions, or performance of any DIY online product. https://www.ftc.gov/news-events/news/press-releases/2025/01/ftc-finalizes-order-hr-block-requiring-them-pay-7-million-overhaul-advertising-customer-service ; case page https://www.ftc.gov/legal-library/browse/cases-proceedings/hr-block-matter ; order https://www.ftc.gov/system/files/ftc_gov/pdf/HRBlock-DecisionandOrder.pdf
- Lesson beyond "free": **dark-pattern upsell/downgrade friction** is an *unfairness* theory (data wiping, forced call to customer service). A freelancer app's tier-upgrade flow must allow self-serve downgrade without data loss.

### 4.3 Tax data privacy — §7216, FTC penalty-offense notices, pixel cases

- **IRC §7216 / §6713** apply to any "tax return preparer," which by regulation **includes a person who develops software used to prepare or file a return and any Authorized IRS e-file Provider** (Treas. Reg. §301.7216-1(b)(2)(i)(B), Example 1: DIY software registration data is tax return information). https://www.law.cornell.edu/cfr/text/26/301.7216-1
- Disclosure/use for anything other than return preparation (including marketing other products, ad targeting, analytics that feed advertising) requires **prior written, knowing, voluntary consent** with prescribed content (Rev. Proc. 2013-14 language for 1040 filers); consent cannot be a condition of service; no retroactive consent. §301.7216-3 https://federal-regs.com/title/26/part-301/301.7216-3/ ; Rev. Proc. 2013-14 https://www.irs.gov/pub/irs-drop/rp-13-14.pdf ; permitted no-consent uses (software updates, QA with contractor notices) §301.7216-2 https://www.law.cornell.edu/cfr/text/26/301.7216-2
- Penalties: §7216 misdemeanor (up to 1 year / $1,000 per violation); §6713 civil $250 per disclosure up to $10,000/yr (amounts as stated in Rev. Proc. 2013-14; later inflation/statutory increases `UNVERIFIED`).
- **FTC Notice of Penalty Offenses (Sept 2023)** to H&R Block, Intuit, TaxAct, TaxSlayer, Ramsey Solutions: using data collected in a confidential context (tax prep) for advertising or unrelated purposes without *affirmative express consent* — including via pixels, cookies, SDKs, APIs — may be an unfair/deceptive practice; civil penalties up to $50,120 per violation. Terms "buried in privacy policies" do not count. https://www.ftc.gov/news-events/news/press-releases/2023/09/ftc-warns-tax-preparation-companies-about-misuse-consumer-data ; cover letter https://search.ftc.gov/system/files/ftc_gov/pdf/NPO-Misuse-Information-Collected-Confidential-Contexts-Cover-Letter_0.pdf
- Background: The Markup (2022) found Meta Pixel on TaxAct, TaxSlayer, H&R Block sending refund/income/dependent data. https://themarkup.org/pixel-hunt/2022/11/22/tax-filing-websites-have-been-sending-users-financial-information-to-facebook. ; Congressional report https://s3.documentcloud.org/documents/23980365/attacks-on-tax-privacy_formatted.pdf
- **Practical rule for the platform**: no third-party marketing/analytics pixels on any screen where tax return information is present; any cross-sell (bookkeeping, banking, insurance) that uses return data needs a Rev. Proc. 2013-14-compliant consent screen.

### 4.4 FTC Safeguards Rule (GLBA) and IRS security expectations

- Tax preparers (including software/e-file providers handling return data) are "financial institutions" under GLBA; the FTC Safeguards Rule (16 CFR Part 314) requires a **written information security program (WISP)**, risk assessment, MFA, encryption, access controls, vendor oversight, and **FTC notification within 30 days of a breach affecting ≥500 consumers**. IRS Pub 4557 https://www.irs.gov/pub/irs-pdf/p4557.pdf ; Pub 5708 WISP template https://www.irs.gov/pub/irs-pdf/p5708.pdf ; JofA https://www.journalofaccountancy.com/issues/2023/feb/how-the-ftc-safeguards-rule-may-affect-your-cpa-firm/
- Pub 1345 (Rev. 12-2025) requires Online Providers to enforce MFA on taxpayer accounts before transmission and on re-login; failures can lead to FTC sanctions and §7216/6713 penalties. https://www.irs.gov/pub/irs-pdf/p1345.pdf

### 4.5 Circular 230 and "tax return preparer" status — what applies to a software company

- **Circular 230** (31 CFR Part 10) governs *practitioners* (attorneys, CPAs, EAs, and others) who *practice before the IRS* — representing taxpayers, corresponding with the IRS, rendering written advice on tax-avoidance arrangements. A software company that does not represent taxpayers and whose employees do not hold themselves out as practitioners is generally **not** subject to Circular 230 as an entity. Definition §10.2(a)(4); solicitation/advertising rules §10.30 (no false, fraudulent, coercive, or misleading claims; fee-schedule rules; 36-month retention of ads) bind practitioners individually. https://www.irs.gov/pub/irs-pdf/pcir230.pdf
  - If the app employs CPAs/EAs who review or sign returns or answer user questions (e.g., Keeper's "tax pro review"), those individuals are practitioners bound by §§10.22 (diligence), 10.30 (solicitation), 10.34 (standards for returns/advice), 10.35 (competence), 10.37 (written advice).
- **"Tax return preparer" (IRC §7701(a)(36); Reg. §301.7701-15)** is a different, broader status that triggers §6694/§6695 penalties, PTIN, and signature requirements. There is **no software exception**: the IRS has long held that a computerized service or software whose program makes substantive determinations (what is deductible, characterization, amounts) can be a preparer (Rev. Ruls. 85-187, 85-188, 85-189; IR-86-62), while "typing, reproduction, or other mechanical assistance" is excluded. Reg. text https://www.law.cornell.edu/cfr/text/26/301.7701-15 ; IRS PMTA 00402 https://www.irs.gov/pub/lanoa/pmta00402_7127.pdf ; scholarly discussion https://repository.law.uic.edu/cgi/viewcontent.cgi?article=1426&context=jitpl
  - In practice the IRS has not treated mass-market DIY software companies as signing preparers under §6695 (the taxpayer self-prepares), but a product that *auto-decides* deductions with minimal user judgment moves toward the Rev. Rul. 85-187 fact pattern. `UNVERIFIED`: no recent IRS enforcement against DIY software as a §6694 preparer was found.
  - Any human who, for compensation, prepares "all or a substantial portion" of a return must have a **PTIN** and sign (§6695(b),(c)).
- **Preparer penalties** the platform should know exist (for its own pros and to explain to users): §6694(a) unreasonable position ($1,000 or 50% of fee, indexed), §6694(b) willful/reckless, §6695 (failure to sign/furnish PTIN/copy/list; negotiating refund checks; EITC/CTC/AOTC/HOH due diligence — Form 8867), §6713/§7216 (privacy). Circular 230 §10.34 mirrors §6694 standards.

### 4.6 Claims a non-preparer, non-representation tax app should avoid

Derived from the FTC orders (Intuit, H&R Block), FTC "Free" Guide (16 CFR 251), Pub 1345 advertising rules, Circular 230 §10.30, and §7216:
- "Free" without qualification unless free for everyone; if tiered, disclose the share of users who qualify (or "most users don't qualify") clearly, in close proximity, on the same screen — not in a footnote.
- "Guaranteed maximum refund," "guaranteed biggest deductions," "100% accurate" without a written, funded guarantee whose terms are disclosed (april's terms are a model of narrow, specific language).
- "Audit protection," "audit defense," or "we'll represent you before the IRS" unless a CPA/EA/attorney under Form 2848 will actually represent the user. "Audit *support*" or "*informational assistance*" is the safe formulation (see §5.4). Representation before the IRS by non-credentialed staff is unauthorized practice.
- "IRS-approved," "IRS-certified," "endorsed by the IRS" — Pub 1345 permits only "Authorized IRS e-file Provider" and prohibits implying IRS endorsement; the IRS does not certify tax software accuracy.
- "SEC-registered," "FINRA-compliant," or "bank-grade" security claims without substantiation (see §1.7; and the FTC treats unsubstantiated security claims as deceptive).
- Refund-timing promises ("refund in 8 days") — Pub 1345 bars EROs from guaranteeing refund dates; IRS's own language is "most refunds in less than 21 days."
- "Write off your [car/home/phone] 100%" style deduction claims — Pub 463/§274(d) substantiation and §280F/§280A limits apply; blanket claims are deceptive and encourage §6662 accuracy penalties for users.
- "Reduce your taxes by $X on average" without a documented, representative basis (FTC substantiation doctrine; the H&R Block order's misrepresentation ban covers "performance, efficacy, nature, or central characteristics").
- Using return data to advertise other products without a §7216 consent — even internally.
- Upgrade prompts that don't disclose the total price, and downgrade paths that wipe data or require contacting support (H&R Block order).
- Positioning the app as "tax advice" from a licensed professional when guidance is generated by software or non-credentialed staff; say "general tax information," "not legal or tax advice," and disclose when a credentialed pro is or isn't involved.

---

## 5. Substantiation and audit-defense record requirements

### 5.1 General rule — burden of proof and what records support Schedule C

- Taxpayer bears the burden to substantiate income and deductions (IRC §6001; Reg. §1.6001-1). Records "must be kept as long as they may be needed for the administration of any provision of the Internal Revenue Code." IRS Pub 583 (12/2024; 12/2025 draft) https://www.irs.gov/publications/p583 ; https://www.irs.gov/pub/irs-dft/p583--dft.pdf
- IRS "What kind of records should I keep": supporting documents include gross-receipts records (invoices, 1099s, deposit slips, cash register tapes), purchases/inventory (canceled checks, credit-card statements, invoices), expenses (receipts, account statements, canceled checks, petty-cash slips), travel/transportation/gift (Pub 463 rules), assets (acquisition date/cost, improvements, §179 and depreciation taken, use, disposition, sale price, selling expenses), and employment taxes (4 years). Electronic systems must meet the same principles as paper. https://www.irs.gov/businesses/small-businesses-self-employed/what-kind-of-records-should-i-keep
- Rev. Proc. 97-22 (electronic storage systems) and Rev. Proc. 98-25 (machine-sensible records) set the standards for electronic record retention: legible, retrievable, indexed, reproducible on request, with controls ensuring integrity — relevant to an app that stores receipts. (Rev. Proc. 97-22 cited in Form 8879 instructions: https://www.irs.gov/pub/irs-pdf/f8879.pdf ; text https://www.irs.gov/pub/irs-irbs/irb97-13.pdf)
- The **Cohan rule** (estimates allowed when a deductible expense clearly occurred but the amount is uncertain) still applies to ordinary Schedule C expenses (supplies, software, etc.) **but is statutorily overridden by §274(d)** for travel, listed property (vehicles), and gifts — those must be substantiated element-by-element or are disallowed entirely. Reg. §1.274-5T(a)(4). https://www.law.cornell.edu/cfr/text/26/1.274-5T

### 5.2 §274(d) "adequate records" — travel, vehicles, gifts (Pub 463)

- Elements to prove for each expense: **amount, time (date), place (destination), business purpose** (and business relationship for gifts). Vehicles (listed property): also **business miles for each use and total miles for the year**, plus cost of the car and date placed in service. Pub 463 (2025) ch. 5, Table 5-1. https://www.irs.gov/publications/p463 ; PDF https://www.irs.gov/pub/irs-pdf/p463.pdf
- "Adequate records" = an account book, diary, log, statement of expense, trip sheet, **or similar record (a computer record qualifies)** made **at or near the time** of the expense, plus documentary evidence (receipts, canceled checks, bills). A weekly log accounting for the week is "at or near the time." Reg. §1.274-5T(c)(2). https://www.law.cornell.edu/cfr/text/26/1.274-5T
- Documentary evidence (receipt) is required for **lodging** (any amount) and for any other expense **of $75 or more**; below $75 (non-lodging) a contemporaneous log entry suffices, but the log must still capture all elements. Pub 463 ch. 5 "Documentary evidence / Exception."
- Business purpose: a written statement is generally required, but not where purpose is evident from surrounding facts (e.g., salesperson on an established route). Reg. §1.274-5T(c)(2)(ii)(B).
- Sampling: a taxpayer may keep a full log for a representative portion of the year (e.g., first week of each month) if it is representative. Pub 463 "Sampling."
- Incomplete records: may substantiate with "sufficient evidence" — the taxpayer's own statement plus other corroborating evidence — a much weaker position. Pub 463 "What if I Have Incomplete Records?"
- Standard mileage rate users still must log time, place, purpose, and miles. Pub 463.
- Home office (§280A): keep evidence of exclusive/regular use, square footage, and home expenses; simplified method ($5/sq ft up to 300 sq ft) still requires proof of qualifying use (Pub 587, not re-sourced here — `UNVERIFIED` link).

### 5.3 How long to keep records — statute of limitations (Pub 583 Table 3)

| Situation | Period |
|---|---|
| General (owe additional tax; none of the below apply) | **3 years** from the later of filing or due date (§6501(a)) |
| Omitted income > 25% of gross income shown on return | **6 years** (§6501(e)) |
| Fraudulent return or no return filed | **No limit** (§6501(c)) |
| Claim for credit/refund after filing | Later of 3 years from filing or 2 years from payment (§6511) |
| Worthless securities / bad-debt deduction | **7 years** |
| Employment tax records | **At least 4 years** after tax becomes due or is paid |
| Property/asset records (basis, depreciation) | Until the limitations period expires for the year of taxable disposition (including carryover basis from like-kind exchanges) |

Sources: https://www.irs.gov/publications/p583 ; https://www.irs.gov/businesses/small-businesses-self-employed/how-long-should-i-keep-records (page updated Aug 2026)

- Practical design guidance: default retention of at least **7 years** for Schedule C support (covers the 6-year substantial-omission window plus filing lag), and **indefinite** for asset/depreciation records, prior-year returns, and NOL/carryforward schedules. Some states have longer periods (e.g., California generally 4 years — `UNVERIFIED` in this pass; NY statute-of-limitations section appears in IT-201 instructions p. 41 https://www.tax.ny.gov/pdf/2025/inc/it201i_2025.pdf).
- Reminder that returns filed early are treated as filed on the due date for the 3-year clock (Pub 583).

### 5.4 How competitor apps present "audit support" (and the line they draw)

- **Keeper**: every filer gets "audit resolution support" — explaining the notice and guiding next steps, year-round Q&A with tax experts. Explicitly **excludes** amending returns and "any form of audit representation" unless on Premium ($399/yr), which adds "expert guidance for your interactions with the IRS," amendments, and collection-arrangement setup; excludes criminal investigations, multi-million-dollar businesses, and returns not filed through Keeper. Every Premium return is "reviewed & signed by a tax professional." https://help.keepertax.com/hc/en-us/articles/15917387938199-Audit-resolution-support ; https://www.keepertax.com/premium
- **Hurdlr**: no in-house audit product; expense/mileage tracker that exports to Schedule C and files via **april**; its help center simply points users to april's guarantees. Hurdlr's positioning is "audit-ready records" (receipts, mileage logs, P&L). https://university.hurdlr.com/en/articles/8767110-is-there-audit-protection-support ; https://www.hurdlr.com/deductions/irs-tax-record-keeping-requirements ; https://university.hurdlr.com/en/articles/8767006-how-does-hurdlr-s-tax-filing-feature-help-me-as-a
- **april** (Hurdlr's filer): "informational assistance, such as responses to frequently asked questions or links to resources ... April will not represent you before the relevant tax authority or provide legal advice." Plus fee refund for calc errors and up to $10,000 penalty/interest reimbursement for software math errors. https://www.getapril.com/for-developers-old
- **FlyFin**: markets "full audit insurance at no cost" — its CPA team "handles the IRS ... prepare responses and communicate with the IRS on your behalf" (i.e., actual representation by CPAs). https://flyfin.tax/ ; https://flyfin.tax/tax-filing . Secondary comparison notes neither Keeper nor FlyFin provides a traditional CPA-level error-correction guarantee. https://aifinancetools.finance/flyfin-vs-keeper-tax-2026/
- Pattern for a non-preparer app: (a) generate and retain §274(d)-compliant logs and receipt images with timestamps and geolocation as the core "audit defense" value; (b) offer notice-explanation and document-assembly "support"; (c) reserve "representation"/"defense" language for a paid tier staffed by CPAs/EAs who will sign Form 2848; (d) publish exclusions (criminal matters, returns not filed through the app, pre-existing issues) as Keeper does.

---

## 6. Open items / UNVERIFIED list (consolidated)

1. TY2027 inflation-adjusted 1099-NEC/MISC threshold — not yet published by IRS.
2. State conformity to the $2,000 1099-NEC threshold (CA yes / MS, WI no per secondary source) — confirm with state DORs.
3. Exact list of state 1099-K thresholds (MT $600, MO $1,200, RI $100) — secondary sources only.
4. Congressional Review Act repeal of the DeFi-broker 1099-DA rule — not independently re-sourced.
5. Whether Column Tax/Aiwyn still onboards new embedded consumer partners post-acquisition.
6. Whether the FTC re-filed the Intuit "free" case in federal district court after the Fifth Circuit's March 20, 2026 vacatur.
7. Washington SB 6346 primary text (2028 income tax; B&O credit/threshold increase) — relied on EY and secondary coverage.
8. Mississippi 2026 rate (4%) and future triggers — secondary only.
9. PA local EIT rate ranges; Ohio/KY/MD/MI/IN municipal net-profit taxes; San Francisco GRT thresholds — flagged as categories, not sourced.
10. California 1% Mental Health Services Tax and CA 4-year statute of limitations — not sourced in this pass.
11. Recent IRS enforcement (if any) treating DIY software vendors as §6694 preparers — none found.
12. Current §6713 penalty amounts after any inflation adjustment.
13. Exact URLs for FL DOR and WA DOR B&O landing pages.

---

## 7. Source index (primary sources first)

IRS / Treasury
- Pub 1099 (2026) General Instructions for Certain Information Returns — https://www.irs.gov/publications/p1099 ; PDF https://www.irs.gov/pub/irs-pdf/p1099.pdf
- Instructions 1099-MISC/NEC (Rev. Dec 2026) — https://www.irs.gov/pub/irs-prior/i1099mec--2026.pdf
- IR-2025-107 / FS-2025-08 1099-K — https://www.irs.gov/newsroom/irs-issues-faqs-on-form-1099-k-threshold-under-the-one-big-beautiful-bill-dollar-limit-reverts-to-20000
- 1099-K FAQs — https://www.irs.gov/newsroom/form-1099-k-faqs-general-information ; Understanding your 1099-K — https://www.irs.gov/businesses/understanding-your-form-1099-k
- Digital asset broker final regs page — https://www.irs.gov/newsroom/final-regulations-and-related-irs-guidance-for-reporting-by-brokers-on-sales-and-exchanges-of-digital-assets
- 1099-DA instructions 2025 — https://www.irs.gov/pub/irs-prior/i1099da--2025.pdf ; 2026 — https://www.irs.gov/instructions/i1099da
- 1099-B instructions (2026) — https://www.irs.gov/instructions/i1099b ; IRC §6045 — https://uscode.house.gov/view.xhtml?req=granuleid%3AUSC-prelim-title26-section6045&num=0&edition=prelim
- 2026 Form W-2 — https://www.irs.gov/pub/irs-pdf/fw2.pdf ; 2026 W-2/W-3 instructions — https://www.irs.gov/instructions/iw2w3
- Notice 2025-62 — https://www.irs.gov/pub/irs-drop/n-25-62.pdf ; IR-2025-110 — https://www.irs.gov/newsroom/treasury-irs-provide-penalty-relief-for-tax-year-2025-for-information-reporting-on-tips-and-overtime-under-the-one-big-beautiful-bill
- Become an authorized e-file provider — https://www.irs.gov/e-file-providers/become-an-authorized-e-file-provider
- Pub 3112 (Rev. 11-2025) — https://www.irs.gov/pub/irs-pdf/p3112.pdf ; Pub 1345 (Rev. 12-2025) — https://www.irs.gov/pub/irs-pdf/p1345.pdf ; Pub 4164 (Rev. 12-2025) — https://www.irs.gov/pub/irs-pdf/p4164.pdf ; Pub 1436 (Rev. 10-2025) — https://www.irs.gov/pub/irs-pdf/p1436.pdf ; Pub 5078 — https://www.irs.gov/pub/irs-pdf/p5078.pdf
- MeF status — https://www.irs.gov/e-file-providers/modernized-e-file-mef-status
- About Form 8879 — https://www.irs.gov/forms-pubs/about-form-8879 ; Form 8879 — https://www.irs.gov/pub/irs-pdf/f8879.pdf ; e-signature FAQ — https://www.irs.gov/e-file-providers/frequently-asked-questions-for-irs-efile-signature-authorization
- Free File 2026 — https://www.irs.gov/newsroom/2026-tax-filing-season-opens-with-several-free-filing-options-available
- Circular 230 — https://www.irs.gov/pub/irs-pdf/pcir230.pdf ; Reg. §301.7701-15 — https://www.law.cornell.edu/cfr/text/26/301.7701-15 ; PMTA 00402 — https://www.irs.gov/pub/lanoa/pmta00402_7127.pdf
- Reg. §301.7216-1/-2/-3 — https://www.law.cornell.edu/cfr/text/26/301.7216-1 ; https://www.law.cornell.edu/cfr/text/26/301.7216-2 ; https://federal-regs.com/title/26/part-301/301.7216-3/ ; Rev. Proc. 2013-14 — https://www.irs.gov/pub/irs-drop/rp-13-14.pdf
- Pub 4557 — https://www.irs.gov/pub/irs-pdf/p4557.pdf ; Pub 5708 — https://www.irs.gov/pub/irs-pdf/p5708.pdf
- Pub 583 — https://www.irs.gov/publications/p583 ; How long to keep records — https://www.irs.gov/businesses/small-businesses-self-employed/how-long-should-i-keep-records ; What records — https://www.irs.gov/businesses/small-businesses-self-employed/what-kind-of-records-should-i-keep
- Pub 463 (2025) — https://www.irs.gov/publications/p463 ; Reg. §1.274-5T — https://www.law.cornell.edu/cfr/text/26/1.274-5T

FTC / courts
- Intuit opinion/order (2024) — https://www.ftc.gov/news-events/news/press-releases/2024/01/ftc-issues-opinion-finding-turbotax-maker-intuit-inc-engaged-deceptive-practices ; Fifth Circuit (Mar 20, 2026) — https://www.ca5.uscourts.gov/opinions/pub/24/24-60040-CV0.pdf
- H&R Block final order (Jan 2025) — https://www.ftc.gov/news-events/news/press-releases/2025/01/ftc-finalizes-order-hr-block-requiring-them-pay-7-million-overhaul-advertising-customer-service ; https://www.ftc.gov/system/files/ftc_gov/pdf/HRBlock-DecisionandOrder.pdf
- Penalty-offense notices (Sept 2023) — https://www.ftc.gov/news-events/news/press-releases/2023/09/ftc-warns-tax-preparation-companies-about-misuse-consumer-data
- SEC broker-dealer guide — https://www.sec.gov/about/divisions-offices/division-trading-markets/division-trading-markets-compliance-guides/guide-broker-dealer-registration

States / localities — see §3.2 and §3.4 tables.

Industry / secondary
- RSM OBBBA reporting alert — https://rsmus.com/insights/tax-alerts/2025/tips-navigating-obbba-new-changes-us-tax-reporting-withholding-rules.html
- Littler — https://www.littler.com/news-analysis/asap/tax-bill-changes-1099-reporting-thresholds
- Tax Foundation 2026 state rates — https://taxfoundation.org/data/all/state/state-income-tax-rates-2026/
- Column Tax / Aiwyn, april, Keeper, Hurdlr, FlyFin — see §2.5 and §5.4.
