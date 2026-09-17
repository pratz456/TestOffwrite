import type { UserProfile } from '@/lib/firebase/profiles-server';
import {
  type HomeOfficeSettings, type RentalHomeOfficeContext, type SimplifiedHomeOfficeCalculation, calc8829,
  HOME_OFFICE_QUALIFYING_USES, SIMPLIFIED_MAX_SQFT,
} from './calc8829';
import { getFederalTaxRules } from '@/lib/tax-rules/federal-year-rules';
import { createPlanningPDF, formatExportMoney as money } from './planning-pdf';
export interface Form8829Data {
  userProfile: UserProfile; homeOfficeSettings: HomeOfficeSettings;
  transactions: unknown[]; taxYear: number;
  /** Narrow rented-home actual-expense subset; the public settings never supply this context. */
  calculationContext?: RentalHomeOfficeContext;
  /** Rev. Proc. 2013-13 worksheet already limited by the shared Schedule C line 29 amount. */
  simplified?: SimplifiedHomeOfficeCalculation;
}

const QUALIFYING_USE_LABELS: Record<(typeof HOME_OFFICE_QUALIFYING_USES)[number], string> = {
  principal_place_of_business: 'Principal place of business (§280A(c)(1)(A))',
  meet_clients: 'Place to meet patients, clients or customers (§280A(c)(1)(B))',
  separate_structure: 'Separate structure not attached to the home (§280A(c)(1)(C))',
  none: 'None of the qualifying uses',
};
const answer = (value: unknown) => value === 'yes' ? 'Yes' : value === 'no' ? 'No' : 'Not answered';

/**
 * Simplified-method planning worksheet. Rev. Proc. 2013-13 taxpayers do not file Form 8829;
 * the amount goes on Schedule C line 30 with the Simplified Method Worksheet from the
 * Schedule C instructions, so this export mirrors that worksheet rather than Form 8829 Part II.
 */
async function simplifiedWorksheet(data: Form8829Data, c: SimplifiedHomeOfficeCalculation): Promise<Uint8Array> {
  const s = data.homeOfficeSettings;
  const pdf = await createPlanningPDF('Home office - simplified method planning worksheet (Schedule C line 30)', data.taxYear);
  pdf.paragraph('Planning worksheet, not an IRS Form 8829. Under the simplified method (Rev. Proc. 2013-13) no Form 8829 is filed; the allowable amount is entered on Schedule C line 30 using the Simplified Method Worksheet in the Schedule C instructions. Eligibility below reflects your saved answers, which your preparer must confirm.', true);
  pdf.paragraph(`Name as saved: ${data.userProfile.name || 'Not provided'}. Tax year ${data.taxYear}.`);
  pdf.section('Saved eligibility facts (Publication 587, "Qualifying for a Deduction")');
  pdf.table(['Fact', 'Saved answer'], [
    ['Regular business use of a specific area', answer(s.regularUse)],
    ['Exclusive business use (no personal use)', answer(s.exclusiveUse)],
    ['Exclusive-use exception claimed', s.exclusiveUse === 'no' ? (s.exclusiveUseException ?? 'Not answered') : 'Not applicable'],
    ['Qualifying use', s.qualifyingUse ? QUALIFYING_USE_LABELS[s.qualifyingUse] : 'Not answered'],
    ['Home is rented or owned', s.housingType ?? 'Not answered'],
    ['Months of qualified use (15+ days count as a month)', String(c.monthsUsed)],
    ['Eligibility result from saved answers', c.eligible ? 'Eligible under the saved answers' : `Not eligible: ${c.ineligibleReason}`],
  ], [298, 230]);
  pdf.section('Simplified Method Worksheet (Schedule C instructions) - planning amounts');
  pdf.table(['Line', 'Description', 'Amount'], [
    ['1', 'Gross income from the business use of the home minus other business expenses (Schedule C line 29 tentative profit from your WriteOff records)', money(c.grossIncomeLimit)],
    ['2', `Allowable square feet (office ${c.officeSqFt} sq ft of ${c.totalHomeSqFt} sq ft home; simplified method limit ${SIMPLIFIED_MAX_SQFT} sq ft)`, `${c.allowableSqFt} sq ft`],
    ['3a', `Average monthly allowable square feet (line 2 x ${c.monthsUsed} months / 12)`, `${c.averageMonthlyAllowableSqFt} sq ft`],
    ['3b', `Prescribed rate per square foot (Rev. Proc. 2013-13 §4.01)`, money(c.ratePerSqFt)],
    ['3c', 'Tentative simplified amount (line 3a x line 3b)', money(c.tentativeDeduction)],
    ['4', 'Allowable amount: smaller of line 1 and line 3c -> Schedule C line 30', money(c.allowableDeduction)],
    ['-', 'Excess not allowed; no carryover under the simplified method (Rev. Proc. 2013-13 §4.08(2))', money(c.disallowedNoCarryover)],
  ], [40, 358, 130]);
  for (const note of c.notes) pdf.paragraph(note);
  pdf.paragraph('Schedule C line 30 also reports the total square footage of the home and of the business-use area. Depreciation of the home for this year is deemed zero (§4.06) and actual home expenses are not deducted on Schedule C; deductible mortgage interest and real estate taxes belong on Schedule A. Switching methods between years is allowed but a year cannot use both.');
  pdf.paragraph('Reference: irs.gov/pub/irs-drop/rp-13-13.pdf, irs.gov/publications/p587 and irs.gov/instructions/i1040sc (Simplified Method Worksheet). This worksheet does not establish eligibility, and any daycare, storage, multiple-home or actual-expense (Form 8829) case requires a separate reviewed calculation.');
  return pdf.save();
}

export async function generateForm8829PDF(data: Form8829Data): Promise<Uint8Array> {
  getFederalTaxRules(data.taxYear);
  if (data.simplified) return simplifiedWorksheet(data, data.simplified);
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
