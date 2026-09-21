'use client';
import React from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export const EMPTY_SOCIAL_SECURITY_ANSWERS = {
  socialSecurityNetBenefits: '', socialSecurityTaxExemptInterest: '',
  socialSecurityExcludedSavingsBondInterest: '', socialSecurityAdoptionExclusion: '',
  socialSecurityFederalWithheld: '', socialSecurityResident: '', socialSecurityLumpSum: '',
  socialSecuritySpecialIRA: '', socialSecurityForeignExclusion: '',
  socialSecurityIncomeComplete: '', socialSecurityAdjustmentsComplete: '',
  socialSecurityLivedApartAllYear: '', socialSecurityRetirementReviewed: '',
};
export type SocialSecurityAnswers = typeof EMPTY_SOCIAL_SECURITY_ANSWERS;
type Field = keyof SocialSecurityAnswers;
export function SocialSecurityFields({ answers, set, filingStatus, hasRetirementIncome = false }: {
  answers: SocialSecurityAnswers;
  set: (key: Field, value: string) => void;
  filingStatus: string;
  hasRetirementIncome?: boolean;
}) {
  const amount = (key: Field, label: string) => <label className="block space-y-1 text-sm" key={key}>
    <span>{label}</span><Input aria-label={label} type="number" step="0.01" value={answers[key]} onChange={event => set(key, event.target.value)} placeholder="Enter amount, including 0" />
  </label>;
  const question = (key: Field, label: string) => <fieldset className="space-y-2" key={key}>
    <legend className="text-sm">{label}</legend><div className="flex gap-2">{['yes', 'no'].map(value => <Button key={value} type="button" size="sm" variant={answers[key] === value ? 'default' : 'outline'} aria-pressed={answers[key] === value} onClick={() => set(key, value)}>{value === 'yes' ? 'Yes' : 'No'}</Button>)}</div>
  </fieldset>;
  return <section aria-label="Social Security benefit worksheet" className="space-y-4 rounded border p-3">
    <h3 className="font-semibold">Calculate the taxable portion</h3>
    <p className="text-xs text-muted-foreground">Use all SSA-1099 and equivalent Tier1 RRB-1099 forms for this return, including your spouse on a joint return. Exclude benefits belonging to your children and Supplemental Security Income (SSI). Existing Box3 records above are kept separately; they are not Box5.</p>
    {amount('socialSecurityNetBenefits', 'Combined Box5 net benefits')}
    {amount('socialSecurityFederalWithheld', 'Federal withholding: SSA-1099 Box6 plus RRB-1099 Box10')}
    {amount('socialSecurityTaxExemptInterest', 'Tax-exempt interest for the return (Form1040 line2a)')}
    {amount('socialSecurityExcludedSavingsBondInterest', 'Savings-bond interest excluded using Form8815 (not included in taxable interest)')}
    {amount('socialSecurityAdoptionExclusion', 'Excluded employer adoption benefits (Form8839)')}
    {question('socialSecurityResident', 'Are all recipients on this return U.S. citizens or residents for the full year, with only SSA-1099/RRB-1099 benefits and no treaty treatment?')}
    {question('socialSecurityLumpSum', 'Do any benefits paid this year cover an earlier tax year?')}
    {hasRetirementIncome && question('socialSecurityRetirementReviewed', 'Is the retirement income entered below the reviewed taxable Box2a amount, with no unresolved basis, rollover or additional early-distribution tax? Choose No if another retirement calculation is needed.')}
    {question('socialSecuritySpecialIRA', 'Did you contribute to a traditional IRA while you or your spouse had workplace or self-employed retirement-plan coverage?')}
    {question('socialSecurityForeignExclusion', 'Do you claim foreign earned-income, foreign housing, American Samoa or Puerto Rico income exclusions?')}
    {filingStatus === 'married_filing_separately' && question('socialSecurityLivedApartAllYear', 'Did you live apart from your spouse for the entire tax year?')}
    {question('socialSecurityIncomeComplete', 'Have you entered all other taxable income for this return in WriteOff, including both spouses on a joint return?')}
    {question('socialSecurityAdjustmentsComplete', 'Have you reviewed deductible amounts in Tax Deductions, and are your only Schedule1 adjustments HSA, self-employed retirement, health insurance, half of SE tax and student-loan interest, with no traditional IRA deduction or other adjustments?')}
    <p className="text-xs text-muted-foreground">The worksheet uses your saved income and deductions. Student-loan interest and deductions below AGI do not reduce this income test. Negative net benefits, earlier-year payments, special IRA calculations, rental/capital income and foreign/treaty cases need separate review. Keep the filing status in Profile and this organizer consistent.</p>
    <a href="/protected?screen=deductions-entry" className="block text-xs underline">Review and save allowed amounts in Tax Deductions</a>
    <a href="https://www.irs.gov/publications/p915" target="_blank" rel="noopener noreferrer" className="text-xs underline">IRS Publication915: worksheet and exceptions</a>
  </section>;
}
