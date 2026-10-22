import { makeAuthenticatedRequest } from '@/lib/firebase/api-client';

/** Organizer and quarterly-payment facts that change the federal estimate. */
export interface DashboardTaxFacts {
  amountOtherIncome: string | number | null;
  dependents: string | number | null;
  payments: { quarter: number; paidAmount: number }[];
}

function scalar(value: unknown): string | number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim()) return value.trim();
  return null;
}

function paidAmount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/**
 * Keep only the values the federal snapshot reads. Document timestamps, notes,
 * and other organizer answers stay out so an unrelated save does not refresh.
 */
export function normalizeDashboardTaxFacts(input?: {
  amountOtherIncome?: unknown;
  dependents?: unknown;
  payments?: unknown;
} | null): DashboardTaxFacts {
  const rows = Array.isArray(input?.payments) ? input.payments : [];
  return {
    amountOtherIncome: scalar(input?.amountOtherIncome),
    dependents: scalar(input?.dependents),
    payments: [1, 2, 3, 4].map(quarter => {
      const row = rows.map(record).find(item => item && Number(item.quarter) === quarter);
      return { quarter, paidAmount: paidAmount(row?.paidAmount) };
    }),
  };
}

export const EMPTY_DASHBOARD_TAX_FACTS: DashboardTaxFacts = normalizeDashboardTaxFacts(null);

export function taxFactsEqual(left: DashboardTaxFacts, right: DashboardTaxFacts): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** Map the organizer and quarterly-payment responses onto the dashboard key. */
export function dashboardTaxFactsFromReads(organizerBody: unknown, paymentsBody: unknown): DashboardTaxFacts {
  const body = record(organizerBody);
  const organizer = record(body?.organizer) ?? body;
  const listed = record(paymentsBody);
  return normalizeDashboardTaxFacts({
    amountOtherIncome: organizer?.amountOtherIncome,
    dependents: organizer?.dependents,
    payments: Array.isArray(listed?.payments) ? listed.payments : [],
  });
}

/**
 * Light reads for the dashboard refresh key. A failed read keeps the previous
 * facts. This does not write, and it does not touch profile.updated_at.
 */
export async function loadDashboardTaxFacts(taxYear: number, signal?: AbortSignal): Promise<DashboardTaxFacts | null> {
  try {
    const [organizerRes, paymentsRes] = await Promise.all([
      makeAuthenticatedRequest(`/api/tax/organizer?year=${taxYear}&view=tax-input`, { signal, cache: 'no-store' }),
      makeAuthenticatedRequest(`/api/tax/quarterly-payments?year=${taxYear}`, { signal, cache: 'no-store' }),
    ]);
    if (!organizerRes.ok || !paymentsRes.ok) return null;
    const organizer = await organizerRes.json().catch(() => null);
    const payments = await paymentsRes.json().catch(() => null);
    return dashboardTaxFactsFromReads(organizer, payments);
  } catch {
    return null;
  }
}
