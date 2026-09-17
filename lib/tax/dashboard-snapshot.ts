import { makeAuthenticatedRequest } from '@/lib/firebase/api-client';

export interface DashboardTaxSnapshot {
  taxYear: number;
  income: { grossReceipts: number; scheduleCNetProfit: number; totalDeductible: number };
  form1040: { totalTax: number; balanceDue: number; refund: number; calculationWarnings: string[] };
}

export type DashboardTaxState =
  | { status: 'loading' }
  | { status: 'ready'; snapshot: DashboardTaxSnapshot }
  | { status: 'review' | 'error'; message: string; code?: string };

export type ReviewTargetScreen = 'settings' | 'tax-organizer' | 'income-tracking' | 'transactions' | 'tax-preview';

export interface ReviewTarget {
  screen: ReviewTargetScreen;
  label: string;
}

/**
 * Where a 422 review code from /api/tax/compute-1040 is resolved. Every screen that
 * shows the shared snapshot links here so the fix lands on the same input screen.
 */
export function reviewTargetForCode(code?: string): ReviewTarget {
  switch (code) {
    case 'FILING_STATUS_REVIEW_REQUIRED': return { screen: 'settings', label: 'Review profile' };
    case 'INCOME_RECONCILIATION_REQUIRED': return { screen: 'income-tracking', label: 'Review income sources' };
    case 'SOCIAL_SECURITY_REVIEW_REQUIRED': return { screen: 'tax-organizer', label: 'Review Social Security records' };
    case 'PERSONAL_DEDUCTION_REVIEW_REQUIRED': return { screen: 'tax-organizer', label: 'Review personal deductions' };
    case 'DEPENDENT_CREDIT_REVIEW_REQUIRED': return { screen: 'tax-organizer', label: 'Review dependent eligibility' };
    case 'CAPITAL_GAIN_REVIEW_REQUIRED': return { screen: 'tax-organizer', label: 'Review capital gain character' };
    case 'BUSINESS_LOSS_REVIEW_REQUIRED': return { screen: 'tax-organizer', label: 'Review business loss facts' };
    case 'OBBBA_DEDUCTION_REVIEW_REQUIRED': return { screen: 'tax-organizer', label: 'Review Working Families Tax Cuts deductions' };
    case 'HOME_OFFICE_REVIEW_REQUIRED': return { screen: 'settings', label: 'Review home office settings' };
    case 'DEPRECIATION_REVIEW_REQUIRED': return { screen: 'settings', label: 'Review asset records' };
    case 'EXPORT_REVIEW_REQUIRED': return { screen: 'transactions', label: 'Review transactions' };
    default: return { screen: 'tax-preview', label: 'Review tax inputs' };
  }
}

/** Display the federal endpoint's values without deriving a second tax estimate. */
export async function loadDashboardTaxSnapshot(taxYear: number, signal?: AbortSignal): Promise<DashboardTaxState> {
  try {
    const response = await makeAuthenticatedRequest(`/api/tax/compute-1040?year=${taxYear}`, { signal, cache: 'no-store' });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      return {
        status: response.status === 422 ? 'review' : 'error',
        message: typeof data?.error === 'string' ? data.error : 'The federal estimate could not be loaded. Please retry.',
        code: typeof data?.code === 'string' ? data.code : undefined,
      };
    }
    const income = data?.income;
    const form = data?.form1040;
    if (data?.taxYear !== taxYear || ![
      income?.grossReceipts, income?.scheduleCNetProfit, income?.totalDeductible,
      form?.totalTax, form?.balanceDue, form?.refund,
    ].every(value => typeof value === 'number' && Number.isFinite(value))) {
      return { status: 'error', message: 'The federal estimate is incomplete or belongs to another year. Please retry.' };
    }
    return { status: 'ready', snapshot: {
      taxYear,
      income: { grossReceipts: income.grossReceipts, scheduleCNetProfit: income.scheduleCNetProfit, totalDeductible: income.totalDeductible },
      form1040: { totalTax: form.totalTax, balanceDue: form.balanceDue, refund: form.refund,
        calculationWarnings: Array.isArray(form.calculationWarnings) ? form.calculationWarnings.filter((item: unknown): item is string => typeof item === 'string') : [],
      },
    } };
  } catch {
    return { status: 'error', message: 'The federal estimate could not be loaded. Please retry.' };
  }
}
