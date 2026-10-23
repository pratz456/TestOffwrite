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
import { DECISION_LABELS, formsConfirmationError, INCOME_SOURCE_KINDS, NOT_BUSINESS_REASONS, PAYMENT_METHOD_HINTS, RECONCILIATION_DECISION_TYPES } from '@/lib/tax-rules/income-reconciliation';
import { INVALID_DECISION_BODY, STALE_APP_REFRESH } from '@/lib/tax-rules/income-reconciliation-copy';
import { isLegacySamePaymentsResave, prepareReconciliationDecision, summarizeIncomeReconciliation } from '@/lib/tax-rules/income-reconciliation-response';
import { guidedReconciliationV1Enabled, kNotBusinessIncomeEnabled, reconciliationDecisionNeedsKSwitch } from '@/lib/tax-rules/reconciliation-feature';

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
  notBusinessParts: z.array(z.object({
    reason: z.enum(NOT_BUSINESS_REASONS),
    amount: z.number().finite().positive().max(1_000_000_000),
  })).max(2).superRefine((parts, ctx) => {
    const seen = new Set<string>();
    parts.forEach((part, index) => {
      if (seen.has(part.reason)) ctx.addIssue({ code: 'custom', message: 'Each reason can be used once.', path: [index, 'reason'] });
      seen.add(part.reason);
    });
  }).optional().default([]),
  paymentMethodHint: z.enum(PAYMENT_METHOD_HINTS).optional(),
  explicitChoice: z.literal(true).optional(),
  confirmedFormsTotal: amountInput.optional(),
  correctedFormId: z.string().trim().min(1).max(200).optional(),
  overlapAmount: amountInput.optional(),
});
const updateInput = decisionInput.extend({ id: z.string().trim().min(1).max(200) });
const englishOr = (items: string[]) => items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`;
const invalidBody = () => {
  if (!guidedReconciliationV1Enabled()) return INVALID_DECISION_BODY;
  const types = [DECISION_LABELS.same_payments, DECISION_LABELS.separate_income, DECISION_LABELS.k_includes_fees];
  if (kNotBusinessIncomeEnabled()) types.push(DECISION_LABELS.k_not_business_income, DECISION_LABELS.partial_overlap);
  types.push(DECISION_LABELS.corrected_form_replaces);
  return `Provide the tax year, a decision type (${englishOr(types)}) and the records it covers with their current amounts.`;
};

/** Same payments that joins two or more 1099s must echo the form total the dialog showed. The value is checked, not stored. */
function requireFormsConfirmation(decision: string, sources: ReadonlyArray<{ kind: string; amount: number }>, confirmedFormsTotal: number | undefined) {
  const error = formsConfirmationError(decision, sources, confirmedFormsTotal);
  return error ? NextResponse.json({ error }, { status: 400 }) : null;
}

function readJson(request: NextRequest) {
  return request.json().catch(() => null);
}

function decisionHidden(decision: string): boolean {
  return (reconciliationDecisionNeedsKSwitch(decision) && !kNotBusinessIncomeEnabled())
    || (decision === 'corrected_form_replaces' && !guidedReconciliationV1Enabled());
}

/** An old cached build still preselects a choice and omits this field. Refuse the save while the guided switch is on. */
function requireExplicitChoice(body: unknown) {
  if (!guidedReconciliationV1Enabled()) return null;
  if (!body || typeof body !== 'object' || (body as { explicitChoice?: unknown }).explicitChoice !== true) {
    return NextResponse.json({ error: STALE_APP_REFRESH }, { status: 400 });
  }
  return null;
}

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
  const raw = await readJson(request);
  const stale = requireExplicitChoice(raw);
  if (stale) return stale;
  const parsed = decisionInput.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: invalidBody() }, { status: 400 });
  if (decisionHidden(parsed.data.decision)) {
    return NextResponse.json({ error: invalidBody() }, { status: 400 });
  }
  try {
    const { taxYear, explicitChoice, confirmedFormsTotal, ...input } = parsed.data;
    void explicitChoice;
    const records = await readIncomeSourceRecords(user.uid, taxYear);
    const prepared = prepareReconciliationDecision(taxYear, records, { id: 'pending', ...input });
    if (!prepared.ok) return NextResponse.json({ error: prepared.reason }, { status: prepared.status });
    const unconfirmed = requireFormsConfirmation(prepared.stored.decision, prepared.stored.sources, confirmedFormsTotal);
    if (unconfirmed) return unconfirmed;
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
  const raw = await readJson(request);
  const stale = requireExplicitChoice(raw);
  if (stale) return stale;
  const parsed = updateInput.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: invalidBody() }, { status: 400 });
  if (decisionHidden(parsed.data.decision)) {
    return NextResponse.json({ error: invalidBody() }, { status: 400 });
  }
  try {
    const { id, taxYear, explicitChoice, confirmedFormsTotal, ...input } = parsed.data;
    void explicitChoice;
    const existing = await getOwnedIncomeReconciliationDecision(user.uid, id);
    if (existing.taxYear !== taxYear) return NextResponse.json({ error: 'A decision stays with the tax year it was recorded for. Remove it and record a decision for the other year.' }, { status: 400 });
    const records = await readIncomeSourceRecords(user.uid, taxYear);
    const prepared = prepareReconciliationDecision(taxYear, records, { id, ...input }, {
      keepLegacySamePayments: isLegacySamePaymentsResave(existing, input),
    });
    if (!prepared.ok) return NextResponse.json({ error: prepared.reason }, { status: prepared.status });
    const unconfirmed = requireFormsConfirmation(prepared.stored.decision, prepared.stored.sources, confirmedFormsTotal);
    if (unconfirmed) return unconfirmed;
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
