export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { analyzeTransactionWithRetry, TransactionInput, findMissingUserFields, convertToEnhancedContext } from '@/lib/ai/analyzeTransaction';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { getAnalysisProfile, analysisProfileHash } from '@/lib/ai/profile-context';
import { loadTaxpayerContext } from '@/lib/ai/taxpayer-context-server';
import { adminDb } from '@/lib/firebase/admin';
import { getAIProviderStatus } from '@/lib/ai/provider-status';
import { claimAnalysisLease, persistAnalysisSuggestion, releaseAnalysisLease, analysisSuggestionUpdate } from '@/lib/ai/analysis-persistence';
import type { AnalysisLease } from '@/lib/ai/analysis-persistence';
import type { DocumentReference } from 'firebase-admin/firestore';

// ── Per-user rate limit: max 60 AI analysis calls per hour ──────────────────
const rateLimitMap = new Map<string, { count: number; windowStart: number }>();
const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

function checkRateLimit(uid: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(uid);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(uid, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count++;
  return true;
}

// Zod schema for request validation
const AnalyzeTransactionRequestSchema = z.object({
  transactionId: z.string().min(1, 'Transaction ID is required'),
  transaction: z.object({
    merchant_name: z.string().min(1, 'Merchant name is required'),
    amount: z.number(),
    category: z.string(),
    date: z.string(),
    datetime: z.string().optional(), // Full datetime from Plaid
    account_id: z.string().optional(),
    description: z.string().optional(),
    notes: z.string().optional(),

    // User-added transaction context fields
    business_purpose: z.string().optional(),
    attendees: z.array(z.string()).optional(),
    travel_destination: z.string().optional(),
    equipment_details: z.object({
      make: z.string().optional(),
      model: z.string().optional(),
      year: z.number().optional(),
      business_use_percentage: z.number().optional(),
      depreciation_method: z.enum(['straight_line', 'declining_balance', 'section_179']).optional()
    }).optional(),
    client_project: z.string().optional(),
    documentation_status: z.enum(['complete', 'partial', 'missing']).optional(),
    meeting_notes: z.string().optional(),
    mileage_details: z.object({
      start_location: z.string().optional(),
      end_location: z.string().optional(),
      miles: z.number().optional(),
      business_purpose: z.string().optional()
    }).optional(),

    city: z.string().optional(),
    state: z.string().optional(),
  }),
});

/** Resolve the actual saved record before sending anything to a model. */
async function ownedTransactionRef(uid: string, transactionId: string): Promise<DocumentReference | null> {
  for (const ownerField of ['userId', 'user_id']) {
    const snap = await adminDb.collectionGroup('transactions').where(ownerField, '==', uid)
      .where('trans_id', '==', transactionId).limit(1).get();
    if (snap.empty) continue;
    const ref = snap.docs[0].ref;
    const parts = ref.path.split('/');
    if (parts.length === 6 && parts[0] === 'user_profiles' && parts[1] === uid
      && parts[2] === 'accounts' && parts[4] === 'transactions') return ref;
  }
  return null;
}

export async function POST(request: NextRequest) {
  let ref: DocumentReference | null = null;
  let lease: AnalysisLease | null = null;
  let releaseCode = 'AI_FAILED';
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!getAIProviderStatus().configured) return NextResponse.json({
      code: 'AI_UNAVAILABLE',
      error: 'AI analysis is currently unavailable. You can review and classify this transaction manually.',
    }, { status: 503 });

    const validation = AnalyzeTransactionRequestSchema.safeParse(await request.json().catch(() => null));
    if (!validation.success) return NextResponse.json({ error: 'Invalid request data' }, { status: 400 });
    const { transactionId } = validation.data;
    ref = await ownedTransactionRef(user.uid, transactionId);
    if (!ref) return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
    if (!checkRateLimit(user.uid)) return NextResponse.json({ code: 'AI_RATE_LIMITED', error: 'Analysis request limit reached. Please try again later.' }, { status: 429 });

    const claim = await claimAnalysisLease(ref);
    if (claim.status === 'missing') return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
    if (claim.status === 'busy') return NextResponse.json({ code: 'AI_IN_PROGRESS', error: 'This transaction is already being analyzed. Wait for its result before retrying.' }, { status: 409 });
    lease = claim.lease;
    const transaction = claim.data;
    if (transaction.pending === true) {
      releaseCode = 'AI_PENDING_TRANSACTION';
      return NextResponse.json({ code: releaseCode, error: 'This bank transaction is pending. Analysis can run once it is posted.' }, { status: 422 });
    }
    const date = typeof transaction.date === 'string' ? transaction.date : '';
    if (typeof transaction.amount !== 'number' || !Number.isFinite(transaction.amount)
      || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date))
      || new Date(date).toISOString().slice(0, 10) !== date
      || transaction.iso_currency_code !== 'USD' || transaction.unofficial_currency_code) {
      releaseCode = 'AI_INPUT_REVIEW';
      return NextResponse.json({ code: releaseCode, error: 'Confirm a valid amount, date and USD currency on this saved record before analysis.' }, { status: 422 });
    }
    const { data: profile, error: profileError } = await getAnalysisProfile(user.uid);
    if (profileError || !profile) return NextResponse.json({ error: 'User profile not found' }, { status: 404 });
    const context = convertToEnhancedContext(profile, date);
    const missingFields = findMissingUserFields(context);
    if (missingFields.length) {
      releaseCode = 'AI_PROFILE_REQUIRED';
      return NextResponse.json({ success: false, code: releaseCode, error: 'Complete your business profile before AI analysis.', missing_user_fields: missingFields }, { status: 422 });
    }

    // Client-supplied financial values cannot override the owner's saved record.
    // The client saves edited context first; the lease detects changes during analysis.
    const input: TransactionInput = {
      ...transaction,
      tx_id: transactionId,
      merchant: String(transaction.merchant_name || transaction.name || ''),
      amount_usd: transaction.amount,
      date_iso: date,
      datetime_iso: transaction.datetime,
      note: transaction.notes || transaction.note || transaction.description,
      mcc: transaction.mcc || transaction.merchant_category_code,
      account_id: ref.path.split('/')[3],
    };
    const taxpayer = await loadTaxpayerContext(user.uid, context, input.merchant, date).catch(() => undefined);
    const analysis = await analyzeTransactionWithRetry(input, taxpayer ? { ...context, taxpayer_context: taxpayer } : context);
    if (!analysis.success) {
      releaseCode = analysis.code || 'AI_FAILED';
      const status = releaseCode === 'AI_UNAVAILABLE' ? 503 : releaseCode === 'AI_RATE_LIMITED' ? 429 : 502;
      const error = releaseCode === 'AI_UNAVAILABLE' ? 'AI analysis is unavailable. Please try again once service is restored; manual review remains available.'
        : releaseCode === 'AI_RATE_LIMITED' ? 'The AI service is busy. Please try again shortly.'
          : 'AI could not complete a reliable assessment. Please retry or review this transaction manually.';
      return NextResponse.json({ code: releaseCode, error }, { status });
    }
    const saved = await persistAnalysisSuggestion(ref, analysis.result, lease, analysisProfileHash(profile, date));
    if (saved.status !== 'saved') {
      releaseCode = 'AI_RECORD_CHANGED';
      return NextResponse.json({ code: releaseCode, error: 'The transaction changed during analysis. Review the latest record and run analysis again.' }, { status: 409 });
    }
    lease = null;
    const fields = analysisSuggestionUpdate(analysis.result);
    return NextResponse.json({ success: true, ai_suggestion: saved.suggestion ?? null, analysis: {
      status: analysis.result.status,
      deductionStatus: fields.ai.status_label,
      confidence: analysis.result.confidence ?? null,
      reasoning: analysis.result.customized_reason || analysis.result.reasoning_summary || analysis.result.key_analysis_factor || 'Review the saved AI suggestion.',
      irsReference: { publication: analysis.result.irs_refs?.[0] || null, section: null },
      updatedAt: fields.analysisUpdatedAt,
    }, updatedAt: fields.analysisUpdatedAt });
  } catch {
    // Model and database payloads can contain financial details; never echo them.
    return NextResponse.json({ code: 'AI_FAILED', error: 'Analysis could not complete. Please retry; your saved records are unchanged.' }, { status: 500 });
  } finally {
    if (ref && lease) {
      try { await releaseAnalysisLease(ref, lease, releaseCode); }
      catch { /* The bounded lease expires if a temporary database failure prevents release. */ }
    }
  }
}
