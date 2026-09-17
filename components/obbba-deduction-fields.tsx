'use client';

import React from 'react';
import { normalizeFilingStatus } from '@/lib/tax-rules/filing-status';
import {
  NON_ITEMIZER_CHARITY_FIRST_YEAR, SCHEDULE_1A_FIRST_YEAR, SCHEDULE_1A_LAST_YEAR,
  readOBBBADeductionAnswers, type OBBBADeductionAnswers,
} from '@/lib/tax-rules/obbba-deductions';

interface Props {
  taxYear: number;
  filingStatus: string;
  /** Saved JSON text for the `obbbaDeductionFacts` organizer field. */
  value: string;
  onChange: (value: string) => void;
}
type AnswerKey = Exclude<keyof OBBBADeductionAnswers, 'version' | 'taxYear'>;

/** Schedule 1-A (tips, overtime, vehicle loan interest) and §170(p) intake; unanswered items are not deducted. */
export function OBBBADeductionFields({ taxYear, filingStatus, value, onChange }: Props) {
  let facts: OBBBADeductionAnswers = { version: 1, taxYear };
  let stale = false;
  try {
    const saved = readOBBBADeductionAnswers(value);
    if (saved && saved.taxYear === taxYear) facts = saved;
    else if (saved) stale = true;
  } catch { /* Malformed records are visibly unanswered; the server applies no deduction. */ }
  let status: ReturnType<typeof normalizeFilingStatus> | null = null;
  try { status = normalizeFilingStatus(filingStatus); } catch { /* Existing filing-status form owns correction. */ }
  const joint = status === 'married_filing_jointly';
  const separate = status === 'married_filing_separately';
  const set = (key: AnswerKey, next: string) => onChange(JSON.stringify({ ...facts, [key]: next }));
  const yesNo = (key: AnswerKey, label: string, hint?: string) => <div className="space-y-1" key={key}>
    <label className="block text-sm font-medium">{label}<select aria-label={label} value={facts[key] || ''} onChange={event => set(key, event.target.value)} className="mt-1 w-full rounded-md border bg-background p-2">
      <option value="">Choose after review</option><option value="yes">Yes</option><option value="no">No</option>
    </select></label>{hint && <p className="text-xs text-muted-foreground">{hint}</p>}
  </div>;
  const amount = (key: AnswerKey, label: string, hint?: string) => <div className="space-y-1" key={key}>
    <label className="block text-sm font-medium">{label}<input aria-label={label} inputMode="decimal" value={facts[key] || ''} onChange={event => set(key, event.target.value)} placeholder="Enter amount, including 0" className="mt-1 w-full rounded-md border bg-background p-2" /></label>
    {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
  </div>;
  if (taxYear < SCHEDULE_1A_FIRST_YEAR || taxYear > SCHEDULE_1A_LAST_YEAR) {
    return <section className="space-y-2 rounded-lg border p-4" aria-labelledby="obbba-deductions-title">
      <h3 id="obbba-deductions-title" className="font-semibold">Working Families Tax Cuts deductions · {taxYear}</h3>
      <p className="text-sm text-muted-foreground">The qualified tips, overtime and vehicle loan interest deductions apply to {SCHEDULE_1A_FIRST_YEAR}–{SCHEDULE_1A_LAST_YEAR} returns only.</p>
    </section>;
  }
  const charityYear = taxYear >= NON_ITEMIZER_CHARITY_FIRST_YEAR;
  const claiming = [facts.hasQualifiedTips, facts.hasW2Overtime, facts.hasVehicleLoanInterest, charityYear ? facts.hasNonItemizerCharity : 'no'].some(answer => answer === 'yes');
  const needsSSN = facts.hasQualifiedTips === 'yes' || facts.hasW2Overtime === 'yes';
  return <section className="space-y-4 rounded-lg border p-4" aria-labelledby="obbba-deductions-title">
    <div><h3 id="obbba-deductions-title" className="font-semibold">Working Families Tax Cuts deductions · {taxYear}</h3><p className="mt-1 text-sm text-muted-foreground">Schedule 1-A deductions (P.L. 119-21) apply whether or not you itemize. Blank answers need review and are not treated as No; an unanswered item is simply not deducted.</p></div>
    {stale && <p role="alert" className="text-sm">Your saved answers belong to another tax year. Review this section for {taxYear}.</p>}

    <div className="space-y-3 border-t pt-4">
      <h4 className="font-medium">Qualified tips (self-employed)</h4>
      {yesNo('hasQualifiedTips', 'Did you receive qualified tips in your business?', 'Voluntary customer tips shown on Form 1099-NEC, 1099-MISC or 1099-K, or reported on Form 4137. Mandatory service charges are not tips. The deduction cannot exceed your Schedule C net profit or $25,000 and phases out above $150,000 MAGI ($300,000 joint).')}
      {facts.hasQualifiedTips === 'yes' && <>
        {amount('qualifiedTipsAmount', 'Qualified tips included in your business income', 'Include these tips in the gross receipts recorded in WriteOff; keep point-of-sale reports or tip logs.')}
        {yesNo('tipsOccupationListed', 'Is your occupation on the Treasury list of tipped occupations?', 'Check IRS.gov/TippedOccupations (Treasury Tipped Occupation Codes). Tips outside a listed occupation are not qualified tips.')}
        {yesNo('tipsBusinessSSTB', 'Is your business a specified service trade or business (SSTB)?', 'Health, law, accounting, consulting, financial services, performing arts, athletics and similar fields (section 199A(d)(2)). Yes routes the estimate to review; Notice 2025-69 transition relief may apply.')}
        {separate && <p role="alert" className="text-sm">Married taxpayers must file jointly to claim the qualified tips deduction.</p>}
      </>}
    </div>

    <div className="space-y-3 border-t pt-4">
      <h4 className="font-medium">Qualified overtime</h4>
      <p className="text-xs text-muted-foreground">Generally unavailable to independent contractors: Fair Labor Standards Act section 7 overtime applies to employees. Only the premium portion of FLSA-required overtime qualifies (up to $12,500; $25,000 joint), with the same MAGI phaseout as tips.</p>
      {yesNo('hasW2Overtime', 'Did you receive qualified overtime as a W-2 employee (box 12 code TT)?')}
      {facts.hasW2Overtime === 'yes' && <>
        {amount('qualifiedOvertimeAmount', 'Qualified overtime compensation from Form W-2 box 12 code TT')}
        {separate && <p role="alert" className="text-sm">Married taxpayers must file jointly to claim the qualified overtime deduction.</p>}
      </>}
      {yesNo('has1099Overtime', 'Was any overtime premium paid to you as a contractor on Form 1099?', 'Rare. Yes routes the estimate to review because contractor overtime is generally not qualified overtime (IRS FS-2026-13).')}
    </div>

    {needsSSN && yesNo('workEligibleSSN', 'Do you have a Social Security number valid for employment?', 'Required for the tips and overtime deductions. Do not enter the number here.')}

    <div className="space-y-3 border-t pt-4">
      <h4 className="font-medium">Passenger vehicle loan interest (personal use)</h4>
      {yesNo('hasVehicleLoanInterest', 'Did you pay interest on a loan for a new personal-use passenger vehicle?', 'Up to $10,000 of interest, phased out by $200 per $1,000 (or part) of MAGI over $100,000 ($200,000 joint). Business-use vehicle interest belongs with Schedule C vehicle expenses instead.')}
      {facts.hasVehicleLoanInterest === 'yes' && <>
        {amount('vehicleLoanInterestAmount', 'Vehicle loan interest paid in the year', 'Use the lender statement. Enter only interest on this vehicle loan.')}
        {yesNo('vehicleLoanAfter2024', 'Was the loan taken out after December 31, 2024?', 'Refinancing an eligible loan qualifies up to the refinanced balance.')}
        {yesNo('vehicleNewUSAssembled', 'Is the vehicle new (original use began with you) with final assembly in the United States?', 'Check the dealer label or the NHTSA VIN decoder. Cars, minivans, vans, SUVs, pickups and motorcycles under 14,000 pounds qualify.')}
        {yesNo('vehiclePersonalUse', 'Is the vehicle used for personal purposes rather than in your business?', 'Choose No for a business vehicle; its interest follows the Schedule C business-interest rules and needs review.')}
        {yesNo('vehicleLoanQualified', 'Is the loan a first-lien purchase loan from an unrelated lender (not a lease)?', 'Leases, related-party loans, fleet or commercial purchases and salvage-title vehicles do not qualify.')}
        <label className="block text-sm font-medium">Vehicle identification number (VIN)<input aria-label="Vehicle identification number (VIN)" value={facts.vehicleVIN || ''} onChange={event => set('vehicleVIN', event.target.value.toUpperCase().slice(0, 17))} placeholder="17 characters" className="mt-1 w-full rounded-md border bg-background p-2 font-mono" maxLength={17} /></label>
        <p className="text-xs text-muted-foreground">The VIN must be reported on Schedule 1-A to claim the deduction.</p>
      </>}
    </div>

    {charityYear && <div className="space-y-3 border-t pt-4">
      <h4 className="font-medium">Charitable gifts without itemizing ({NON_ITEMIZER_CHARITY_FIRST_YEAR} onward)</h4>
      {yesNo('hasNonItemizerCharity', 'Did you give cash to public charities while taking the standard deduction?', `Up to $1,000 ($2,000 joint) of cash gifts to public charities (section 170(p)). Donor-advised funds, supporting organizations, most private foundations and property gifts do not count. Itemizers deduct gifts on Schedule A instead.`)}
      {facts.hasNonItemizerCharity === 'yes' && amount('nonItemizerCashCharity', 'Cash gifts to public charities', 'Keep bank records or written acknowledgments for every gift.')}
    </div>}

    {claiming && yesNo('magiForeignExclusions', 'Do you exclude foreign earned income (Form 2555) or U.S. territory income?', 'Schedule 1-A modified AGI adds those exclusions back. Yes routes the estimate to review; the exclusions are not calculated here.')}
    {joint && <p className="text-xs text-muted-foreground">Joint return limits and thresholds are applied automatically.</p>}
    <p className="text-xs text-muted-foreground">Save the organizer to apply changes. Answers are your declarations for the planning estimate; keep statements and receipts for your tax preparer.</p>
  </section>;
}
