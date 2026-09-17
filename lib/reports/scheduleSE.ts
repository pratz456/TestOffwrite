import type { UserProfile } from '@/lib/firebase/profiles-server';
import type { ScheduleSECalculation } from './calcSE';
import { getTaxRatesAndLimits } from './calcSE';
import { createPlanningPDF, formatExportMoney as money } from './planning-pdf';
export interface ScheduleSEData {
  userProfile: UserProfile; taxYear: number; calculation: ScheduleSECalculation;
  w2SocialSecurityWages: number; w2MedicareWages: number;
}
export async function generateScheduleSEPDF(data: ScheduleSEData): Promise<Uint8Array> {
  const { userProfile, taxYear, calculation: c } = data;
  const rates = getTaxRatesAndLimits(taxYear);
  const pdf = await createPlanningPDF('Schedule SE - self-employment tax worksheet', taxYear);
  pdf.paragraph('Preparer review only. This worksheet is not an official Schedule SE or a complete tax return. It uses one taxpayer’s recorded nonfarm business income and W-2 wage amounts.', true);
  pdf.paragraph(`Name as saved: ${userProfile.name || 'Not provided'} | Filing status: ${userProfile.filing_status}`);
  pdf.paragraph('Confirm that all business earnings and wages belong to the same taxpayer. Each spouse with self-employment income needs a separate Schedule SE. Farm, church, railroad, unreported-tip, optional-method and exemption cases need separate review.');
  pdf.table(['Worksheet input / result', 'Amount'], [
    ['Schedule C line 31 planning profit (after supported de minimis items, depreciation and simplified home office)', money(c.netProfitFromScheduleC)], ['Other SE adjustments', money(c.adjustments)],
    ['Net earnings before 92.35% factor', money(c.netEarnings)], ['Positive SE earnings after 92.35% factor', money(c.seBase)],
    [`${taxYear} Social Security wage base`, money(rates.socialSecurityWageBase)], ['Recorded W-2 Social Security wages', money(data.w2SocialSecurityWages)],
    ['Remaining Social Security wage base', money(Math.max(0, rates.socialSecurityWageBase - data.w2SocialSecurityWages))],
    ['Social Security tax (12.4%)', money(c.socialSecurityTax)], ['Regular Medicare tax (2.9%)', money(c.medicareTax)],
    ['Regular self-employment tax (Schedule SE line 12)', money(c.totalSETax)], ['One-half SE deduction (Schedule SE line 13)', money(c.halfSEDeduction)],
  ], [398, 130]);
  pdf.section('Separate Form 8959 planning');
  pdf.table(['Item', 'Amount'], [['Recorded W-2 Medicare wages used', money(data.w2MedicareWages)], ['SE portion of Additional Medicare Tax', money(c.additionalMedicareTax)]], [398, 130]);
  pdf.paragraph('The Additional Medicare amount is excluded from Schedule SE tax and its half-tax deduction. This is only the self-employment portion; complete Form 8959 wage tax and withholding reconciliation separately.');
  pdf.paragraph('Income and expense classification, depreciation elections, complete income sources, taxpayer identity/SSN, and supporting schedules must be verified before filing. The wage figures may use the fallback described in the saved W-2 record when individual wage boxes were omitted.');
  pdf.paragraph('References: irs.gov/instructions/i1040sse and ssa.gov/oact/COLA/cbb.html. Published2025 Schedule SE line references are used for 2026 planning.');
  return pdf.save();
}
