import { makeAuthenticatedRequest } from '@/lib/firebase/api-client';
import { ORGANIZER_TAX_INPUT_FIELDS, organizerTaxInputValues, type OrganizerTaxInputField, type OrganizerTaxInputValues } from '@/lib/tax-rules/organizer-tax-inputs';

/** Fired after a successful organizer or quarterly-payment save. */
export const DASHBOARD_TAX_INPUTS_UPDATED = 'writeoff:tax-inputs-updated';

/** Ask a mounted dashboard to reread organizer tax inputs and quarterly payments. */
export function notifyDashboardTaxInputsUpdated(target?: EventTarget) {
  const host = target ?? (typeof window === 'undefined' ? null : window);
  host?.dispatchEvent(new Event(DASHBOARD_TAX_INPUTS_UPDATED));
}

/** Organizer answers and quarterly payments that change the federal estimate. */
export type DashboardTaxFacts = OrganizerTaxInputValues & {
  payments: { quarter: number; paidAmount: number }[];
};

/** Partial organizer answers supplied by a test. Production loads the full set. */
export type DashboardTaxFactsInput = Partial<OrganizerTaxInputValues> & {
  payments: DashboardTaxFacts['payments'];
};

function paidAmount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/**
 * Keep only the organizer answers the federal snapshot reads, plus recorded
 * quarterly payments. Notes and other answers stay out so an unrelated save
 * does not refresh.
 */
export function normalizeDashboardTaxFacts(input?: {
  payments?: unknown;
  idKindNeedsReview?: unknown;
} & Partial<Record<OrganizerTaxInputField, unknown>> | null): DashboardTaxFacts {
  const rows = Array.isArray(input?.payments) ? input.payments : [];
  return {
    ...organizerTaxInputValues(input ?? undefined),
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
  const picked: Partial<Record<OrganizerTaxInputField, unknown>> = {};
  for (const field of ORGANIZER_TAX_INPUT_FIELDS) picked[field] = organizer?.[field];
  return normalizeDashboardTaxFacts({
    ...picked,
    idKindNeedsReview: organizer?.idKindNeedsReview,
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
