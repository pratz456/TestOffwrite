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
