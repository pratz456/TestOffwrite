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
import { claimAnalysisLease, persistAnalysisSuggestion, releaseAnalysisLease } from '@/lib/ai/analysis-persistence';
import type { AnalysisLease } from '@/lib/ai/analysis-persistence';
import type { DocumentReference } from 'firebase-admin/firestore';
import { ANALYZE_TRANSACTION_USER_LIMIT, ANALYZE_TRANSACTION_USER_WINDOW_MS, enforceRateLimit, RATE_LIMITS, rateLimitResponse, withInvalidRequestLimit } from '@/lib/security/rate-limit';
import { readJsonBody } from '@/lib/http/json-body';
import { isCountableRecord } from '@/lib/transactions/record-scope';

const contextText = z.string().max(5000);
const AnalyzeTransactionRequestSchema = z.object({
  transactionId: z.string().min(1, 'Transaction ID is required').max(256),
  transaction: z.object({
    merchant_name: z.string().min(1, 'Merchant name is required').max(500),
    amount: z.number(),
    category: z.string().max(200),
    date: z.string().max(64),
    datetime: z.string().max(64).optional(),
    account_id: z.string().max(256).optional(),
    description: contextText.optional(),
    notes: contextText.optional(),
    business_purpose: contextText.optional(),
    attendees: z.array(z.string().max(300)).max(100).optional(),
    travel_destination: contextText.optional(),
    equipment_details: z.object({
      make: contextText.optional(),
      model: contextText.optional(),
      year: z.number().optional(),
      business_use_percentage: z.number().optional(),
      depreciation_method: z.enum(['straight_line', 'declining_balance', 'section_179']).optional()
    }).optional(),
    client_project: contextText.optional(),
    documentation_status: z.enum(['complete', 'partial', 'missing']).optional(),
    meeting_notes: contextText.optional(),
    mileage_details: z.object({
      start_location: contextText.optional(),
      end_location: contextText.optional(),
      miles: z.number().optional(),
      business_purpose: contextText.optional()
    }).optional(),
    city: z.string().max(200).optional(),
    state: z.string().max(100).optional(),
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

    // Read the body and check its fields before the usage counter. Invalid requests use this route's invalid request counter.
    const raw = await readJsonBody(request);
    if (raw instanceof NextResponse) {
      const failure = raw.status === 413 ? raw : NextResponse.json({ error: 'Invalid request data' }, { status: 400 });
      return withInvalidRequestLimit(user.uid, RATE_LIMITS.analyzeTransactionInvalidRequest, failure);
    }
    const validation = AnalyzeTransactionRequestSchema.safeParse(raw);
    if (!validation.success) {
      return withInvalidRequestLimit(user.uid, RATE_LIMITS.analyzeTransactionInvalidRequest, NextResponse.json({ error: 'Invalid request data' }, { status: 400 }));
    }
    // Per-owner model spend is bounded durably across instances (60 per hour);
    // an unreachable limiter store refuses rather than allowing unmetered calls.
    const limit = await enforceRateLimit({
      ...RATE_LIMITS.aiAnalyzeTransaction,
      limit: ANALYZE_TRANSACTION_USER_LIMIT,
      windowMs: ANALYZE_TRANSACTION_USER_WINDOW_MS,
      key: user.uid,
    });
    if (!limit.allowed) return rateLimitResponse(limit, { code: 'AI_RATE_LIMITED', error: 'Analysis request limit reached. Please try again later.' });
    const { transactionId } = validation.data;
    ref = await ownedTransactionRef(user.uid, transactionId);
    if (!ref) return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });

    const claim = await claimAnalysisLease(ref);
    if (claim.status === 'missing') return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
    if (claim.status === 'busy') return NextResponse.json({ code: 'AI_IN_PROGRESS', error: 'This transaction is already being analyzed. Wait for its result before retrying.' }, { status: 409 });
    lease = claim.lease;
    const transaction = claim.data;
    if (transaction.pending === true) {
      releaseCode = 'AI_PENDING_TRANSACTION';
      return NextResponse.json({ code: releaseCode, error: 'This bank transaction is pending. Analysis can run once it is posted.' }, { status: 422 });
    }
    if (!isCountableRecord(transaction)) {
      releaseCode = 'TRANSACTION_UNAVAILABLE';
      return NextResponse.json({ code: releaseCode, error: 'This bank record was removed or linked to an earlier record, so it is not eligible for AI analysis.' }, { status: 422 });
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
    const pathParts = ref.path.split('/');
    const accountId = pathParts[3];
    const accountSnapshot = await adminDb.doc(pathParts.slice(0, 4).join('/')).get();
    const account = accountSnapshot.exists ? accountSnapshot.data() ?? {} : {};
    const accountUsageType = ['business', 'personal', 'mixed'].includes(account.usageType)
      ? account.usageType as 'business' | 'personal' | 'mixed'
      : 'unknown';
    const accountBusinessUse = Number(account.businessUsePercent ?? account.business_use_percentage);
    const input: TransactionInput = {
      ...transaction,
      tx_id: transactionId,
      merchant: String(transaction.merchant_name || transaction.name || ''),
      amount_usd: transaction.amount,
      date_iso: date,
      datetime_iso: transaction.datetime,
      note: transaction.notes || transaction.note || transaction.description,
      mcc: transaction.mcc || transaction.merchant_category_code,
      account_id: accountId,
      account_usage_type: accountUsageType,
      receipt_context: transaction.receipt_url || transaction.receipt_filename || transaction.ocr_data ? {
        attached: true,
        ...(typeof transaction.ocr_data?.confidence === 'number' && Number.isFinite(transaction.ocr_data.confidence)
          ? { ocr_confidence: transaction.ocr_data.confidence }
          : {}),
      } : { attached: false },
      ...(transaction.business_use_percentage == null && accountUsageType === 'mixed'
        && Number.isFinite(accountBusinessUse) && accountBusinessUse >= 0 && accountBusinessUse <= 100
        ? { business_use_percentage: accountBusinessUse }
        : {}),
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
    const saved = await persistAnalysisSuggestion(ref, analysis.result, lease, analysisProfileHash(profile, date), context);
    if (saved.status !== 'saved') {
      releaseCode = 'AI_RECORD_CHANGED';
      return NextResponse.json({ code: releaseCode, error: 'Your transaction or business profile changed during analysis. Review the latest details and run analysis again.' }, { status: 409 });
    }
    lease = null;
    return NextResponse.json({
      success: true,
      ai_suggestion: saved.suggestion,
      explanation: saved.explanation,
      ai: saved.display.ai,
      analysis: {
        status: saved.display.status,
        deductionStatus: saved.display.statusLabel,
        confidence: saved.display.confidence,
        reasoning: saved.display.reasoning || 'Review the saved AI suggestion.',
        irsReference: {
          publication: saved.display.irsPublication,
          section: saved.display.irsSection,
        },
        updatedAt: saved.display.updatedAt,
      },
      updatedAt: saved.display.updatedAt,
    });
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
