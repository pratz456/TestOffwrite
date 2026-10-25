import { normalizeFilingStatus } from '@/lib/tax-rules/filing-status';

/**
 * Shared check for the prior-year method. Single, head of household, and
 * married filing separately are separate returns. Only a change between a
 * joint return and a separate return, in either direction, needs review.
 */
export interface PriorYearSameTaxpayersResult {
  allowed: boolean;
  review: boolean;
  message: string;
}

export interface PriorYearFilingStatusInput {
  priorYearFilingStatus: string;
  currentYearFilingStatus: string;
}

const JOINT_SEPARATE_REVIEW = 'PLACEHOLDER The prior-year tax needs adjusting for the change between a joint return and separate returns.';

function returnShape(value: string): 'joint' | 'separate' | null {
  if (value.trim() === '') return null;
  try {
    return normalizeFilingStatus(value) === 'married_filing_jointly' ? 'joint' : 'separate';
  } catch {
    return null;
  }
}

export function priorYearSameTaxpayersAndFilingStatus(
  input: boolean | PriorYearFilingStatusInput,
): PriorYearSameTaxpayersResult {
  if (typeof input === 'boolean') {
    if (input === true) return { allowed: true, review: false, message: '' };
    return { allowed: false, review: true, message: JOINT_SEPARATE_REVIEW };
  }
  const prior = returnShape(input.priorYearFilingStatus);
  const current = returnShape(input.currentYearFilingStatus);
  if (prior === null || current === null) {
    return {
      allowed: false,
      review: true,
      message: 'PLACEHOLDER Choose last year\'s filing status before using the prior-year tax. Single, head of household, and married filing separately are separate returns.',
    };
  }
  if (prior === current) return { allowed: true, review: false, message: '' };
  return { allowed: false, review: true, message: JOINT_SEPARATE_REVIEW };
}
