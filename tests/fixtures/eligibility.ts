import type { EligibilityFacts } from '@/lib/tax-rules/eligibility';

export const hsaFacts = (patch: Partial<NonNullable<EligibilityFacts['hsa']>> = {}): NonNullable<EligibilityFacts['hsa']> => ({
  owner: 'taxpayer', age55: 'no', notDependent: 'yes', eligibleCoverageConfirmed: 'yes', monthlyMethod: 'yes', onlyOneHolder: 'yes',
  familyAllocationAgreed: 'yes', employerContributions: '0', otherReductions: '0', noDistributionsOrPriorExcess: 'yes',
  months: Array.from({ length: 12 }, () => ({ coverage: 'self', medicare: 'no' })), ...patch,
});
export const healthFacts = (patch: Partial<NonNullable<EligibilityFacts['health']>> = {}): NonNullable<EligibilityFacts['health']> => ({
  soleProprietor: 'yes', policyUnderBusiness: 'yes', coveredPeopleEligible: 'yes', nonMarketplace: 'yes', noLongTermCare: 'yes',
  noReimbursement: 'yes', oneBusiness: 'yes', noForeignIncomeExclusion: 'yes', months: Array.from({ length: 12 }, () => ({ premiums: '600', employerAccess: 'no' })), ...patch,
});
export const retirementFacts = (patch: Partial<NonNullable<EligibilityFacts['retirement']>> = {}): NonNullable<EligibilityFacts['retirement']> => ({
  soleProprietor: 'yes', plan: 'sep_ira', establishedAndTimely: 'yes', onlyPlan: 'yes', noEmployees: 'yes', noOtherDeferrals: 'yes',
  traditionalOnly: 'yes', noCatchUp: 'yes', earnedFromServices: 'yes', employeeContribution: '0', employerContribution: '10000', employerRate: '25', ...patch,
});
export const jointFacts = (patch: Partial<NonNullable<EligibilityFacts['joint']>> = {}): NonNullable<EligibilityFacts['joint']> => ({
  oneSelfEmployedSpouse: 'yes', businessOwner: 'taxpayer', taxpayerWages: '0', spouseWages: '100000', taxpayerSSWages: '0', spouseSSWages: '100000',
  taxpayerMedicareWages: '0', spouseMedicareWages: '100000', ...patch,
});
export const eligibilityOrganizer = (facts: Partial<EligibilityFacts> = {}) => ({ adjustmentEligibilityFacts: JSON.stringify({ version: 1, taxYear: 2026, ...facts }) });
