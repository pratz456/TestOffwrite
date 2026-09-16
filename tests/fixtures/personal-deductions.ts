import type { PersonalDeductionAnswers } from '../../lib/tax-rules/personal-deductions';

/** Explicit, synthetic reviewed declarations. Never use as application defaults. */
export function reviewedPersonalDeductionOrganizer(taxYear = 2026, facts: Partial<PersonalDeductionAnswers> = {}, organizer: Record<string, unknown> = {}) {
  return {
    taxYear,
    dateOfBirth: '1990-05-20',
    spouseDoB: '1991-06-20',
    personalDeductionFacts: JSON.stringify({
      version: 1, taxYear, ordinaryScope: 'yes', taxpayerBlind: 'no', taxpayerDependent: 'no',
      spouseBlind: 'no', spouseDependent: 'no', mfsSpouseItemizes: 'no', mfsSpouseAdditionalEligible: 'no',
      taxpayerSeniorSSN: 'yes', spouseSeniorSSN: 'yes', seniorHasAddbacks: 'no', ...facts,
    } satisfies PersonalDeductionAnswers),
    ...organizer,
  };
}
