import type { UserProfile } from '@/lib/firebase/profiles-server';
import { type Asset, type DepreciationElections, calc4562, DE_MINIMIS_SAFE_HARBOR_LIMIT } from './calc4562';
import { createPlanningPDF, formatExportMoney as money } from './planning-pdf';
export interface Form4562Data {
  userProfile: UserProfile; assetsSettings: Asset[]; transactions: unknown[]; taxYear: number;
  /** §179(b)(3)(A) business taxable income supplied by the shared Schedule C ordering; omitted means none was established. */
  businessIncome?: number;
  elections?: DepreciationElections | null;
}
const TREATMENT_LABELS = { de_minimis_expense: 'De minimis safe harbor expense (not depreciated)', section_179: 'Section 179 election plus MACRS on the remaining basis', macrs: 'MACRS half-year' } as const;
export async function generateForm4562PDF(data: Form4562Data): Promise<Uint8Array> {
  const businessIncome = data.businessIncome ?? 0;
  const c = calc4562(data.assetsSettings, businessIncome, data.taxYear, data.elections ?? null);
  const pdf = await createPlanningPDF('Form 4562 - supported depreciation worksheet', data.taxYear);
  pdf.paragraph('Preparer review only, not an IRS Form 4562 or complete depreciation schedule. Supported cases: first-year nonlisted 5/7-year property (MACRS half-year), Section 179 elections for 2025-2026 property with more than 50% business use, and de minimis safe harbor items in an elected year. Bonus depreciation, vehicles and listed property, prior-year basis, straight-line and mid-quarter cases require review.', true);
  pdf.paragraph(`Name as saved: ${data.userProfile.name || 'Not provided'}. Assets calculated: ${c.assets.length}.`);
  pdf.table(['Supported calculation', 'Amount'], [
    ['De minimis safe harbor items expensed on Schedule C (not Form 4562)', money(c.totalDeMinimisExpense)],
    ['Section 179 deduction allowed this year (Form 4562 line 12)', money(c.totalSection179)],
    ['Regular MACRS depreciation', money(c.totalRegularDepreciation)],
    ['Total supported depreciation (Form 4562 line 22 equivalent)', money(c.totalDepreciation)],
    ['Section 179 carryover to next year (Form 4562 line 13)', money(c.totalCarryover)],
  ], [398, 130]);
  if (c.section179) {
    pdf.section(`Section 179 limits applied for ${c.section179.electionYear}`);
    pdf.table(['Limit', 'Amount'], [
      [`Maximum §179 deduction (${c.section179.source})`, money(c.section179.limit)],
      ['Phaseout threshold (§179(b)(2))', money(c.section179.phaseoutThreshold)],
      ['Cost of §179 property placed in service this year', money(c.section179.costOfSection179Property)],
      ['Dollar limit after phaseout', money(c.section179.dollarLimitAfterPhaseout)],
      ['Business taxable income limit supplied (§179(b)(3)(A); Schedule C profit before §179 plus W-2 wages)', money(c.section179.businessIncomeLimit)],
      ['Amount elected (reduces basis now, Reg. §1.179-1(f))', money(c.section179.elected)],
      ['Amount allowed this year', money(c.section179.allowed)],
      ['Carryover (§179(b)(3)(B))', money(c.section179.carryover)],
    ], [398, 130]);
  }
  for (const note of c.notes) pdf.paragraph(note);
  pdf.section('Complete asset detail');
  for (const item of c.assets) {
    const a = item.asset;
    const rawDate = a.datePlacedInService as unknown;
    const date = rawDate && typeof rawDate === 'object' && 'toDate' in rawDate && typeof rawDate.toDate === 'function' ? rawDate.toDate() as Date : new Date(rawDate as string | Date);
    pdf.section(a.description);
    pdf.table(['Recorded fact / calculation', 'Value'], [
      ['Asset identifier', a.id], ['Placed in service', date.toISOString().slice(0, 10)], ['Cost', money(a.cost)],
      ['Business-use percentage', `${a.businessUsePercent}%`], ['Business basis', money(a.cost * a.businessUsePercent / 100)],
      ['Treatment', TREATMENT_LABELS[item.treatment]],
      ...(item.treatment === 'de_minimis_expense'
        ? [['Current-year expense (Reg. §1.263(a)-1(f); item cost at or under $' + DE_MINIMIS_SAFE_HARBOR_LIMIT.toLocaleString('en-US') + ')', money(item.deMinimisExpense)]]
        : [
          ['Method / convention', `${a.method}; half-year`],
          ['Section 179 elected / allowed this year', `${money(item.section179Elected)} / ${money(item.section179Deduction)}`],
          ['Current-year regular depreciation', money(item.regularDepreciation)],
          ['Total current-year depreciation', money(item.totalDepreciation)],
          ['Section 179 carryover', money(item.carryoverToNextYear)],
          ['Remaining business basis', money(item.remainingBasis)],
        ]),
    ], [295, 233]);
  }
  pdf.paragraph('Review recovery class, acquisition/service dates, any required elections, business-use evidence, and prior depreciation with your preparer. This export does not claim that omitted elections or carryovers are zero. Retain the source documents; this worksheet cannot be filed instead of Form 4562.');
  pdf.paragraph('Reference: irs.gov/publications/p946 (chapter 2 Section 179, Tables A-1/A-2), irs.gov/instructions/i4562 and Reg. §1.263(a)-1(f) (de minimis safe harbor election statement).');
  return pdf.save();
}
