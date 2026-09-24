'use client';
import React from 'react';
import { readEligibilityFacts, type EligibilityFacts } from '@/lib/tax-rules/eligibility';

interface Props {
  taxYear: number; filingStatus: string; value: string; onChange: (value: string) => void;
  showHsa?: boolean; showHealth?: boolean; showRetirement?: boolean; showJoint?: boolean;
  annualPremium?: string;
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const inputClass = 'mt-1 w-full rounded-md border bg-background p-2 text-sm';

/** All eligibility choices begin unanswered. Bulk actions fill only the facts the user explicitly chooses. */
export function AdjustmentEligibilityFields({ taxYear, filingStatus, value, onChange, showHsa, showHealth, showRetirement, showJoint, annualPremium }: Props) {
  let facts: EligibilityFacts = { version: 1, taxYear };
  let stale = false;
  try { const saved = readEligibilityFacts(value); if (saved?.taxYear === taxYear) facts = saved; else if (saved) stale = true; } catch { stale = true; }
  const update = <K extends 'hsa' | 'health' | 'retirement' | 'joint'>(section: K, patch: Partial<NonNullable<EligibilityFacts[K]>>) =>
    onChange(JSON.stringify({ ...facts, [section]: { ...facts[section], ...patch } }));
  const choice = (label: string, selected: string | undefined, change: (next: string) => void, items = [['yes', 'Yes'], ['no', 'No']]) => <label className="block text-sm" key={label}>{label}
    <select aria-label={label} className={inputClass} value={selected || ''} onChange={event => change(event.target.value)}>
      <option value="">Choose</option>{items.map(([id, text]) => <option key={id} value={id}>{text}</option>)}
    </select></label>;
  const dollars = (label: string, selected: string | undefined, change: (next: string) => void) => <label className="block text-sm" key={label}>{label}
    <input aria-label={label} type="number" min="0" step="0.01" className={inputClass} value={selected || ''} onChange={event => change(event.target.value)} placeholder="Enter 0 if none" />
  </label>;
  const disclosure = (label: string, children: React.ReactNode) => <details className="rounded-lg border p-3" key={label}><summary className="cursor-pointer text-sm font-medium">{label}</summary><div className="mt-3 space-y-3">{children}</div></details>;
  const hsa = facts.hsa || {};
  const hsaMonths = hsa.months || MONTHS.map(() => ({ coverage: '' as const, medicare: '' as const }));
  const health = facts.health || {};
  const healthMonths = health.months || MONTHS.map(() => ({ premiums: '', employerAccess: '' as const }));
  const retirement = facts.retirement || {};
  const joint = facts.joint || {};
  return <div className="space-y-3" aria-label="Saved deduction eligibility">
    {stale && <p role="alert" className="text-sm">Saved eligibility needs review for {taxYear}. Unanswered facts are not treated as No.</p>}
    {showHsa && disclosure('HSA eligibility · monthly worksheet', <>
      <p className="text-xs text-muted-foreground">Use after-tax contributions in the amount above. Payroll salary reductions and W-2 code W belong in employer contributions. This worksheet supports one contributing HSA holder; distributions, excess carryovers and last-month-rule elections need separate review.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {choice('HSA account holder', hsa.owner, next => update('hsa', { owner: next as typeof hsa.owner }), filingStatus === 'married_filing_jointly' ? [['taxpayer', 'Taxpayer'], ['spouse', 'Spouse']] : [['taxpayer', 'Taxpayer']])}
        {choice('Holder was age 55 or older at year end', hsa.age55, next => update('hsa', { age55: next as typeof hsa.age55 }))}
        {choice('Holder cannot be claimed as another taxpayer’s dependent', hsa.notDependent, next => update('hsa', { notDependent: next as typeof hsa.notDependent }))}
        {choice('One contributing HSA holder; no spouse HSA contributions', hsa.onlyOneHolder, next => update('hsa', { onlyOneHolder: next as typeof hsa.onlyOneHolder }))}
        {choice('Use actual eligible months without the last-month rule', hsa.monthlyMethod, next => update('hsa', { monthlyMethod: next as typeof hsa.monthlyMethod }))}
        {choice('No HSA distributions, prior excess or testing-period failure', hsa.noDistributionsOrPriorExcess, next => update('hsa', { noDistributionsOrPriorExcess: next as typeof hsa.noDistributionsOrPriorExcess }))}
        {choice('Months marked eligible have HSA-qualified coverage and no disqualifying other coverage', hsa.eligibleCoverageConfirmed, next => update('hsa', { eligibleCoverageConfirmed: next as typeof hsa.eligibleCoverageConfirmed }))}
        {filingStatus.startsWith('married_') && choice('Family limit allocated to this holder by agreement; none used by spouse', hsa.familyAllocationAgreed, next => update('hsa', { familyAllocationAgreed: next as typeof hsa.familyAllocationAgreed }))}
        {dollars('Employer and payroll HSA contributions ($)', hsa.employerContributions, next => update('hsa', { employerContributions: next }))}
        {dollars('Archer MSA / IRA-to-HSA funding distributions ($)', hsa.otherReductions, next => update('hsa', { otherReductions: next }))}
      </div>
      <p className="text-xs text-muted-foreground">Choose coverage on the first day of each month. Medicare enrollment, including retroactive enrollment, makes that month ineligible.</p>
      {filingStatus.startsWith('married_') && <p className="text-xs text-muted-foreground">For an eligible month, use Family if either spouse had family HDHP coverage. Self-only coverage does not override the married family limit.</p>}
      <p className="text-xs text-muted-foreground">Employer contributions must be for this tax year. Adjust W-2 code W for prior-year contributions and contributions made next year for this year.</p>
      <div className="flex flex-wrap gap-2">{(['self', 'family'] as const).map(coverage => <button type="button" className="rounded border px-2 py-1 text-xs" key={coverage} onClick={() => update('hsa', { months: hsaMonths.map(month => ({ ...month, coverage })) })}>{coverage === 'self' ? 'Self-only' : 'Family'} all year</button>)}
        <button type="button" className="rounded border px-2 py-1 text-xs" onClick={() => update('hsa', { months: hsaMonths.map(month => ({ ...month, medicare: 'no' })) })}>No Medicare all year</button></div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{hsaMonths.map((month, index) => <fieldset className="rounded border p-2" key={MONTHS[index]}><legend className="px-1 text-xs">{MONTHS[index]}</legend>
        {choice(`${MONTHS[index]} HSA coverage`, month.coverage, next => update('hsa', { months: hsaMonths.map((m, i) => i === index ? { ...m, coverage: next as typeof month.coverage } : m) }), [['none', 'Not eligible'], ['self', 'Self-only'], ['family', 'Family']])}
        {choice(`${MONTHS[index]} Medicare enrolled`, month.medicare, next => update('hsa', { months: hsaMonths.map((m, i) => i === index ? { ...m, medicare: next as typeof month.medicare } : m) }))}
      </fieldset>)}</div>
    </>)}
    {showHealth && disclosure('Health insurance eligibility · monthly premiums', <>
      <p className="text-xs text-muted-foreground">Medical, dental and vision premiums for one sole-proprietor business. Marketplace tax credits and long-term-care insurance need separate worksheets.</p>
      <div className="grid gap-3 sm:grid-cols-2">{([
        ['soleProprietor', 'Sole proprietor or disregarded single-member LLC'], ['policyUnderBusiness', 'Policy established under this business, in your name or business name'],
        ['coveredPeopleEligible', 'Covers only you, spouse, dependents or your child under 27'], ['nonMarketplace', 'No Marketplace / Form 1095-A coverage'],
        ['noLongTermCare', 'No long-term-care premiums included'], ['noReimbursement', 'No reimbursed, pre-tax, excluded or already-deducted amounts'], ['oneBusiness', 'One business establishes all these policies'],
        ['noForeignIncomeExclusion', 'No foreign earned-income or housing exclusion (Form 2555)'],
      ] as const).map(([key, label]) => choice(label, health[key], next => update('health', { [key]: next })))}</div>
      <p className="text-xs text-muted-foreground">Exclude a whole month if you were eligible for subsidized coverage at any time that month through your employer, your spouse’s employer, or an employer of your dependent or child under 27, even if you declined the plan.</p>
      <div className="flex flex-wrap gap-2"><button type="button" className="rounded border px-2 py-1 text-xs" onClick={() => update('health', { months: healthMonths.map(month => ({ ...month, employerAccess: 'no' })) })}>No employer plan access all year</button>
        {annualPremium && Number(annualPremium) >= 0 && <button type="button" className="rounded border px-2 py-1 text-xs" onClick={() => {
          const cents = Math.round(Number(annualPremium) * 100), monthly = Math.floor(cents / 12);
          update('health', { months: healthMonths.map((month, index) => ({ ...month, premiums: ((monthly + (index === 11 ? cents - monthly * 12 : 0)) / 100).toFixed(2) })) });
        }}>Premiums were equal monthly</button>}</div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{healthMonths.map((month, index) => <fieldset className="rounded border p-2" key={MONTHS[index]}><legend className="px-1 text-xs">{MONTHS[index]}</legend>
        {dollars(`${MONTHS[index]} premiums ($)`, month.premiums, next => update('health', { months: healthMonths.map((m, i) => i === index ? { ...m, premiums: next } : m) }))}
        {choice(`${MONTHS[index]} employer plan eligible`, month.employerAccess, next => update('health', { months: healthMonths.map((m, i) => i === index ? { ...m, employerAccess: next as typeof month.employerAccess } : m) }))}
      </fieldset>)}</div>
    </>)}
    {showRetirement && disclosure('Retirement eligibility · one traditional plan', <>
      <p className="text-xs text-muted-foreground">Supports 2025–26 owner-only SEP, Solo 401(k), and standard SIMPLE contributions. Catch-ups, Roth, other plans and enhanced SIMPLE limits remain review cases.</p>
      {choice('Plan used for the saved contribution', retirement.plan, next => update('retirement', { plan: next as typeof retirement.plan }), [['sep_ira', 'SEP-IRA'], ['solo_401k', 'Solo 401(k)'], ['simple_ira', 'SIMPLE IRA']])}
      <div className="grid gap-3 sm:grid-cols-2">{([
        ['soleProprietor', 'Sole proprietor / disregarded LLC for this plan'], ['establishedAndTimely', 'Plan, elections and contributions met tax-year deadlines'],
        ['onlyPlan', 'Only this plan and business affect the contribution limits'], ['noEmployees', 'No employees, including spouse employees, in this business'],
        ['noOtherDeferrals', 'No elective deferrals to other employer plans'], ['traditionalOnly', 'Traditional contributions only; no Roth, rollovers or after-tax amounts'],
        ['noCatchUp', 'No catch-up contributions claimed'], ['earnedFromServices', 'Your services materially helped produce the business income'],
      ] as const).map(([key, label]) => choice(label, retirement[key], next => update('retirement', { [key]: next })))}</div>
      <div className="grid gap-3 sm:grid-cols-2">
        {dollars('Employee elective contributions ($)', retirement.employeeContribution, next => update('retirement', { employeeContribution: next }))}
        {dollars('Employer contributions ($)', retirement.employerContribution, next => update('retirement', { employerContribution: next }))}
        {retirement.plan !== 'simple_ira' && dollars('Plan employer contribution rate (%)', retirement.employerRate, next => update('retirement', { employerRate: next }))}
        {retirement.plan === 'simple_ira' && choice('SIMPLE employer method', retirement.simpleMethod, next => update('retirement', { simpleMethod: next as typeof retirement.simpleMethod }), [['match3', '3% match'], ['nonelective2', '2% nonelective']])}
      </div>
    </>)}
    {showJoint && disclosure('Assign joint-return wages and business income', <>
      <p className="text-xs text-muted-foreground">Use totals from all saved W-2 forms for each person. The estimate checks these against current records. One spouse’s wages cannot reduce the other spouse’s Social Security business-income base.</p>
      {choice('Exactly one spouse earned all recorded business income', joint.oneSelfEmployedSpouse, next => update('joint', { oneSelfEmployedSpouse: next as typeof joint.oneSelfEmployedSpouse }))}
      {choice('Self-employed spouse', joint.businessOwner, next => update('joint', { businessOwner: next as typeof joint.businessOwner }), [['taxpayer', 'Taxpayer'], ['spouse', 'Spouse']])}
      <div className="grid gap-3 sm:grid-cols-2">{([
        ['taxpayerWages', 'Taxpayer W-2 Box 1 ($)'], ['spouseWages', 'Spouse W-2 Box 1 ($)'],
        ['taxpayerSSWages', 'Taxpayer W-2 Boxes 3 + 7 ($)'], ['spouseSSWages', 'Spouse W-2 Boxes 3 + 7 ($)'],
        ['taxpayerMedicareWages', 'Taxpayer W-2 Box 5 ($)'], ['spouseMedicareWages', 'Spouse W-2 Box 5 ($)'],
      ] as const).map(([key, label]) => dollars(label, joint[key], next => update('joint', { [key]: next })))}</div>
    </>)}
    {(showHsa || showHealth || showRetirement || showJoint) && <p className="text-xs text-muted-foreground">Save the organizer to apply these declarations. Missing facts or contributions above supported limits keep the estimate in review.</p>}
  </div>;
}
