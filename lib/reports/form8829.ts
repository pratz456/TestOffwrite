import type { UserProfile } from '@/lib/firebase/profiles-server';
import { type HomeOfficeSettings, type RentalHomeOfficeContext, calc8829 } from './calc8829';
import { getFederalTaxRules } from '@/lib/tax-rules/federal-year-rules';
import { createPlanningPDF, formatExportMoney as money } from './planning-pdf';
export interface Form8829Data {
  userProfile: UserProfile; homeOfficeSettings: HomeOfficeSettings;
  transactions: unknown[]; taxYear: number; calculationContext?: RentalHomeOfficeContext;
}
export async function generateForm8829PDF(data: Form8829Data): Promise<Uint8Array> {
  getFederalTaxRules(data.taxYear);
  // Public settings lack this context: preserve the explicit review response.
  const c = calc8829(data.homeOfficeSettings, data.calculationContext);
  const pdf = await createPlanningPDF('Form 8829 - rental home-office worksheet', data.taxYear);
  pdf.paragraph('Not an IRS Form 8829. Supported actual operating expenses for a qualified rented home only; review the income limit, eligible period and carryovers before filing.', true);
  pdf.paragraph(`Name as saved: ${data.userProfile.name || 'Not provided'}. Business-use area: ${data.homeOfficeSettings.officeSqFt} of ${data.homeOfficeSettings.totalHomeSqFt} square feet (${c.businessUsePercentage.toFixed(2)}%).`);
  const labels = { rentOrMortgageInterest: 'Rent', utilities: 'Utilities', insurance: 'Insurance', repairsMaintenance: 'Repairs and maintenance', propertyTax: 'Property tax', other: 'Other' };
  pdf.table(['Expense', 'Recorded total', 'Allocated share'], Object.entries(labels).map(([key, label]) => [label, money(data.homeOfficeSettings[key as keyof typeof labels]), money(c.allocatedExpenses[key as keyof typeof labels])]), [278, 125, 125]);
  pdf.table(['Reviewed worksheet amount', 'Amount'], [
    ['Indirect operating allocation', money(c.totalAllocatedExpenses)], ['Direct operating expenses', money(c.directOfficeExpenses)],
    ['Prior operating-expense carryover', money(data.calculationContext!.priorOperatingExpenseCarryover)],
    ['Income limit supplied for Form8829 line 8', money(data.calculationContext!.form8829Line8Income)],
    ['Allowed operating deduction for this subset', money(c.totalAllowableDeduction)], ['Operating-expense carryover', money(c.carryoverToNextYear)],
  ], [398, 130]);
  pdf.paragraph('The simplified square-foot method is separate; it is not a $1,500 cap on actual expenses. Owned homes, mortgage/tax ordering, casualty losses, depreciation, daycare, and other unsupported facts require a separate reviewed calculation.');
  pdf.paragraph('Reference: irs.gov/instructions/i8829 and irs.gov/publications/p587. This summary does not complete every Form 8829 field or establish eligibility.');
  return pdf.save();
}
