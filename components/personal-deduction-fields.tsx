'use client';

import React from 'react';
import { normalizeFilingStatus } from '@/lib/tax-rules/filing-status';
import { isAge65AtTaxYearEnd, readPersonalDeductionAnswers, type PersonalDeductionAnswers } from '@/lib/tax-rules/personal-deductions';

type Values = { personalDeductionFacts?: string; dateOfBirth?: string; spouseDoB?: string };
interface Props {
  taxYear: number;
  filingStatus: string;
  answers: Values;
  onChange: (field: keyof Values, value: string) => void;
}
type AnswerKey = Exclude<keyof PersonalDeductionAnswers, 'version' | 'taxYear'>;

/** All selections remain unanswered until the taxpayer reviews them; parent saves one text field. */
export function PersonalDeductionFields({ taxYear, filingStatus, answers, onChange }: Props) {
  let facts: PersonalDeductionAnswers = { version: 1, taxYear };
  let stale = false;
  try {
    const saved = readPersonalDeductionAnswers(answers.personalDeductionFacts);
    if (saved.taxYear === taxYear) facts = saved;
    else stale = true;
  } catch { /* Missing/malformed records are visibly unanswered and server review-blocked. */ }
  let status: ReturnType<typeof normalizeFilingStatus> | null = null;
  try { status = normalizeFilingStatus(filingStatus); } catch { /* Existing filing-status form owns correction. */ }
  const joint = status === 'married_filing_jointly';
  const separate = status === 'married_filing_separately';
  const set = (key: AnswerKey, value: string) => onChange('personalDeductionFacts', JSON.stringify({ ...facts, [key]: value }));
  const yesNo = (key: AnswerKey, label: string, hint?: string) => <div className="space-y-1" key={key}>
    <label className="block text-sm font-medium">{label}<select aria-label={label} value={facts[key] || ''} onChange={event => set(key, event.target.value)} className="mt-1 w-full rounded-md border bg-background p-2">
      <option value="">Choose after review</option><option value="yes">Yes</option><option value="no">No</option>
    </select></label>{hint && <p className="text-xs text-muted-foreground">{hint}</p>}
  </div>;
  const amount = (key: AnswerKey, label: string) => <label key={key} className="block text-sm font-medium">{label}<input aria-label={label} inputMode="decimal" value={facts[key] || ''} onChange={event => set(key, event.target.value)} placeholder="Enter amount, including 0" className="mt-1 w-full rounded-md border bg-background p-2" /></label>;
  const date = (field: 'dateOfBirth' | 'spouseDoB', label: string) => <label className="block text-sm font-medium">{label}<input aria-label={label} type="date" value={answers[field] || ''} max={`${taxYear}-12-31`} onChange={event => onChange(field, event.target.value)} className="mt-1 w-full rounded-md border bg-background p-2" /></label>;
  const older = (value?: string) => { try { return isAge65AtTaxYearEnd(value, taxYear); } catch { return null; } };
  const taxpayerOlder = older(answers.dateOfBirth), spouseOlder = joint ? older(answers.spouseDoB) : false;
  const showSpouse = joint || (separate && facts.mfsSpouseAdditionalEligible === 'yes');
  const possibleSenior = taxYear >= 2025 && !separate && (taxpayerOlder !== false || spouseOlder !== false);
  const isDependent = facts.taxpayerDependent === 'yes' || (joint && facts.spouseDependent === 'yes');
  return <section className="space-y-4 rounded-lg border p-4" aria-labelledby="personal-deductions-title">
    <div><h3 id="personal-deductions-title" className="font-semibold">Personal deductions · {taxYear}</h3><p className="mt-1 text-sm text-muted-foreground">These facts determine your standard deduction and any enhanced senior deduction. Blank answers need review; they are not treated as No.</p></div>
    {stale && <p role="alert" className="text-sm">Your saved answers belong to another tax year. Review this section for {taxYear}.</p>}
    {yesNo('ordinaryScope', 'Do the ordinary full-year deduction rules apply?', 'Yes means a full calendar-year return for living U.S. citizens or residents, with no nonresident/dual-status rules, territorial standard-deduction allocation, short tax year or qualified-disaster increase. Choose No if one needs review.')}
    {facts.ordinaryScope === 'no' && <p role="alert" className="text-sm">Keep your documents for tax review. These special deduction rules are not calculated here.</p>}
    {date('dateOfBirth', 'Your date of birth for deduction eligibility')}
    {yesNo('taxpayerBlind', 'Do you meet the IRS blindness definition?', 'Blind on the last day of the year, or certified vision no better than 20/200 with correction or a field of vision of 20 degrees or less. Keep the required medical statement.')}
    {yesNo('taxpayerDependent', 'Can another taxpayer claim you as a dependent?', 'Answer Yes if they can claim you, even if they choose not to.')}
    {separate && <>
      {yesNo('mfsSpouseItemizes', 'Does your spouse itemize deductions on a separate return?')}
      {facts.mfsSpouseItemizes === 'yes' && <p className="text-sm">Your standard deduction is zero. Review your own itemized deductions. The enhanced senior deduction is unavailable when married filing separately.</p>}
      {yesNo('mfsSpouseAdditionalEligible', 'Can your spouse’s age or blindness count on your separate return?', 'Yes only if your spouse had no gross income, is not filing a return and cannot be claimed as someone else’s dependent.')}
    </>}
    {showSpouse && <>
      {date('spouseDoB', 'Spouse date of birth for deduction eligibility')}
      {yesNo('spouseBlind', 'Does your spouse meet the IRS blindness definition?')}
      {joint && yesNo('spouseDependent', 'Can another taxpayer claim your spouse as a dependent?')}
    </>}
    {isDependent && <div className="space-y-1">{amount('dependentEarnedIncome', 'Earned income for the dependent deduction worksheet')}<p className="text-xs text-muted-foreground">Use the return’s earned income for Publication 501 Table 8, including wages, work income and taxable scholarships; account for business losses. Exclude interest and Social Security. Do not use total bank deposits or AGI.</p></div>}
    {possibleSenior && <div className="space-y-4 border-t pt-4">
      <h4 className="font-medium">Enhanced senior deduction</h4><p className="text-sm text-muted-foreground">For eligible people age 65 or older, this separate deduction applies even when itemizing. Age uses the IRS day-before-birthday rule, including January 1 birthdays. It does not make all Social Security benefits tax-free.</p>
      {taxpayerOlder !== false && yesNo('taxpayerSeniorSSN', 'Do you have an eligible SSN for the senior deduction?', 'The SSN must be valid for employment and issued by the return due date, including extensions. Do not enter the number here.')}
      {joint && spouseOlder !== false && yesNo('spouseSeniorSSN', 'Does your spouse have an eligible SSN for the senior deduction?', 'The same valid-for-employment and issuance-deadline rules apply separately to your spouse.')}
      {yesNo('seniorHasAddbacks', 'Do foreign or territory amounts need to be added back for senior MAGI?', 'Review excluded Puerto Rico income, Form 2555 lines 45 and 50, and Form 4563 line 15. Unknown amounts require review. These entries do not calculate foreign exclusions or territorial tax returns.')}
      {facts.seniorHasAddbacks === 'yes' && <div className="grid gap-3 sm:grid-cols-2">
        {amount('excludedPuertoRicoIncome', 'Excluded Puerto Rico income')}{amount('form2555Line45', 'Form 2555 line 45')}
        {amount('form2555Line50', 'Form 2555 line 50')}{amount('form4563Line15', 'Form 4563 line 15')}
      </div>}
    </div>}
    <p className="text-xs text-muted-foreground">Save the organizer to apply changes. Eligibility answers are your declarations; they do not establish dependent-credit eligibility.</p>
  </section>;
}
