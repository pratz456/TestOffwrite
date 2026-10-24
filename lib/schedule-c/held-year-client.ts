"use client";

import type { ScheduleCExportSnapshot } from './filed-year';

export type { ScheduleCExportSnapshot } from './filed-year';

export const SCHEDULE_C_FILED_YEAR_PATH = '/api/tax/schedule-c/filed-year';

async function authHeader(): Promise<Headers | null> {
  const { auth } = await import('@/lib/firebase/client');
  const currentUser = auth.currentUser;
  if (!currentUser) return null;
  const headers = new Headers();
  headers.set('Authorization', `Bearer ${await currentUser.getIdToken()}`);
  return headers;
}

function isScheduleCExportSnapshot(value: unknown): value is ScheduleCExportSnapshot {
  if (!value || typeof value !== 'object') return false;
  const record = value as ScheduleCExportSnapshot;
  if (typeof record.rulesVersion !== 'string' || typeof record.totalDeductible !== 'number') return false;
  if (!Array.isArray(record.lineTotals) || !Array.isArray(record.charges)) return false;
  return record.lineTotals.every(row => !!row && typeof row.line === 'string' && typeof row.amount === 'number')
    && record.charges.every(row => !!row && typeof row.id === 'string' && typeof row.line === 'string' && typeof row.amount === 'number');
}

/** Stored rules versions from user_tax_year_confirmations for the signed in user. */
export async function readStoredConfirmedRulesVersions(): Promise<Record<string, string>> {
  try {
    const headers = await authHeader();
    if (!headers) return {};
    const response = await fetch(SCHEDULE_C_FILED_YEAR_PATH, { headers, credentials: 'include' });
    if (!response.ok) return {};
    const body = await response.json() as { confirmations?: unknown };
    if (!body.confirmations || typeof body.confirmations !== 'object') return {};
    const stored: Record<string, string> = {};
    for (const [year, version] of Object.entries(body.confirmations)) {
      if (typeof version === 'string') stored[year] = version;
    }
    return stored;
  } catch {
    return {};
  }
}

export interface StoredScheduleCPrior {
  prior: ScheduleCExportSnapshot | null;
  /** True while a pending export marker is still open. The stored prior is still returned. */
  latestExportUnrecorded: boolean;
  /** True when the filed-year read failed, including a missing auth header or a non-ok response. */
  readFailed: boolean;
}

/** Latest Schedule C CSV or PDF export for one held year, or null when none is saved. */
export async function readStoredScheduleCPrior(year: number): Promise<StoredScheduleCPrior> {
  const failed: StoredScheduleCPrior = { prior: null, latestExportUnrecorded: false, readFailed: true };
  try {
    const headers = await authHeader();
    if (!headers) return failed;
    const response = await fetch(`${SCHEDULE_C_FILED_YEAR_PATH}?year=${year}`, { headers, credentials: 'include' });
    if (!response.ok) return failed;
    const body = await response.json() as { prior?: unknown; latestExportUnrecorded?: unknown };
    const latestExportUnrecorded = body.latestExportUnrecorded === true;
    return {
      prior: isScheduleCExportSnapshot(body.prior) ? body.prior : null,
      latestExportUnrecorded,
      readFailed: false,
    };
  } catch {
    return failed;
  }
}
