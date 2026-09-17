/**
 * Income reconciliation API — the owner's explicit decisions about overlapping
 * income evidence (1099-NEC/K forms, direct income entries and bank income).
 * Collection: income_reconciliations/{id}; every read and write is owner-scoped.
 *
 * GET    ?year=2026 — candidates, saved decisions and the conflicts that block a
 *                     total ("why is my income blocked"); never merges or matches
 *                     records by itself.
 * POST              — record a decision; validated against the current records.
 * PATCH             — replace a decision the caller owns.
 * DELETE ?id=xxx    — remove a decision the caller owns (records are untouched).
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthenticatedUser, isSameOriginRequest } from '@/lib/firebase/api-auth';
import {
  createIncomeReconciliationDecision, deleteIncomeReconciliationDecision, getOwnedIncomeReconciliationDecision,
  IncomeReconciliationAccessError, readIncomeSourceRecords, updateIncomeReconciliationDecision,
} from '@/lib/firebase/income-reconciliations-server';
import { ExportDataUnavailableError } from '@/lib/reports/export-records';
import { ExportReviewRequiredError } from '@/lib/reports/transaction-export';
import { INCOME_SOURCE_KINDS, RECONCILIATION_DECISION_TYPES } from '@/lib/tax-rules/income-reconciliation';
import { prepareReconciliationDecision, summarizeIncomeReconciliation } from '@/lib/tax-rules/income-reconciliation-response';

const NO_STORE = { 'Cache-Control': 'private, no-store' };
const yearInput = z.union([z.number(), z.string().trim().regex(/^\d{4}$/)]).transform(Number).pipe(z.number().int().min(2000).max(2100));
const amountInput = z.number().finite().nonnegative().max(1_000_000_000);
const sourceInput = z.object({ kind: z.enum(INCOME_SOURCE_KINDS), id: z.string().trim().min(1).max(200), amount: amountInput });
const decisionInput = z.object({
  taxYear: yearInput,
  decision: z.enum(RECONCILIATION_DECISION_TYPES),
  sources: z.array(sourceInput).min(1).max(50),
  platformFeeAmount: amountInput.nullish().transform(value => value ?? 0),
  note: z.string().trim().max(500).nullish().transform(value => value ?? ''),
});
const updateInput = decisionInput.extend({ id: z.string().trim().min(1).max(200) });
const INVALID_BODY = 'Provide the tax year, a decision type (same_payments, separate_income or k_includes_fees) and the records it covers with their current amounts.';

function failure(error: unknown, action: string) {
  if (error instanceof IncomeReconciliationAccessError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof ExportReviewRequiredError) return NextResponse.json({ error: error.message, code: error.code }, { status: 422 });
  if (error instanceof ExportDataUnavailableError) return NextResponse.json({ error: error.message, code: error.code }, { status: 503 });
  console.error(`[income reconciliation ${action}]`, error);
  return NextResponse.json({ error: `Could not ${action} the reconciliation decision. Please retry.` }, { status: 500 });
}

/** Cookie credentials are sent automatically, so mutations must come from this application. */
function crossSite(request: NextRequest) {
  return isSameOriginRequest(request) ? null : NextResponse.json({ error: 'Cross-site request rejected' }, { status: 403 });
}

export async function GET(request: NextRequest) {
  const { user, error } = await getAuthenticatedUser(request);
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const year = yearInput.safeParse(request.nextUrl.searchParams.get('year') ?? new Date().getFullYear());
  if (!year.success) return NextResponse.json({ error: 'Provide a valid tax year.' }, { status: 400 });
  try {
    const records = await readIncomeSourceRecords(user.uid, year.data);
    return NextResponse.json(summarizeIncomeReconciliation(year.data, records), { headers: NO_STORE });
  } catch (err) {
    return failure(err, 'load');
  }
}

export async function POST(request: NextRequest) {
  const rejected = crossSite(request);
  if (rejected) return rejected;
  const { user, error } = await getAuthenticatedUser(request);
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const parsed = decisionInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: INVALID_BODY }, { status: 400 });
  try {
    const { taxYear, ...input } = parsed.data;
    const records = await readIncomeSourceRecords(user.uid, taxYear);
    const prepared = prepareReconciliationDecision(taxYear, records, { id: 'pending', ...input });
    if (!prepared.ok) return NextResponse.json({ error: prepared.reason }, { status: prepared.status });
    const id = await createIncomeReconciliationDecision(user.uid, prepared.stored);
    return NextResponse.json({ success: true, id, countedAmount: prepared.stored.countedAmount }, { status: 201, headers: NO_STORE });
  } catch (err) {
    return failure(err, 'save');
  }
}

export async function PATCH(request: NextRequest) {
  const rejected = crossSite(request);
  if (rejected) return rejected;
  const { user, error } = await getAuthenticatedUser(request);
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const parsed = updateInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: INVALID_BODY }, { status: 400 });
  try {
    const { id, taxYear, ...input } = parsed.data;
    const existing = await getOwnedIncomeReconciliationDecision(user.uid, id);
    if (existing.taxYear !== taxYear) return NextResponse.json({ error: 'A decision stays with the tax year it was recorded for. Remove it and record a decision for the other year.' }, { status: 400 });
    const records = await readIncomeSourceRecords(user.uid, taxYear);
    const prepared = prepareReconciliationDecision(taxYear, records, { id, ...input });
    if (!prepared.ok) return NextResponse.json({ error: prepared.reason }, { status: prepared.status });
    await updateIncomeReconciliationDecision(user.uid, id, prepared.stored);
    return NextResponse.json({ success: true, id, countedAmount: prepared.stored.countedAmount }, { headers: NO_STORE });
  } catch (err) {
    return failure(err, 'update');
  }
}

export async function DELETE(request: NextRequest) {
  const rejected = crossSite(request);
  if (rejected) return rejected;
  const { user, error } = await getAuthenticatedUser(request);
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const id = request.nextUrl.searchParams.get('id')?.trim();
  if (!id || id.length > 200) return NextResponse.json({ error: 'id is required' }, { status: 400 });
  try {
    await deleteIncomeReconciliationDecision(user.uid, id);
    return NextResponse.json({ success: true }, { headers: NO_STORE });
  } catch (err) {
    return failure(err, 'remove');
  }
}
