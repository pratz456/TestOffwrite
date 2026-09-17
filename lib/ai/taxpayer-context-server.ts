import { adminDb } from '@/lib/firebase/admin';
import type { UserContext } from './analyzeTransaction';
import { buildTaxpayerContext, summarizeConfirmedMerchants, type ConfirmedTransactionRecord, type HomeOfficeFacts, type TaxpayerAnalysisContext } from './taxpayer-context';

const CONFIRMED_PER_ACCOUNT = 150;

/** Reads only user-confirmed rows; AI suggestions and pending records never become priors. */
export async function loadConfirmedTransactionRecords(uid: string): Promise<ConfirmedTransactionRecord[]> {
  const accounts = await adminDb.collection('user_profiles').doc(uid).collection('accounts').get();
  const snapshots = await Promise.all(accounts.docs.map(account =>
    account.ref.collection('transactions').where('review_status', '==', 'confirmed').limit(CONFIRMED_PER_ACCOUNT).get()));
  return snapshots.flatMap(snapshot => snapshot.docs.map(doc => {
    const data = doc.data();
    return {
      merchant_name: data.merchant_name ?? null, name: data.name ?? null, category: data.category ?? null,
      expense_type: data.expense_type ?? null, is_deductible: typeof data.is_deductible === 'boolean' ? data.is_deductible : null,
      review_status: data.review_status ?? null, business_purpose: data.business_purpose ?? null,
      date: data.date ?? null, reviewed_at: data.reviewed_at ?? null,
    };
  }));
}

async function loadHomeOfficeFacts(uid: string): Promise<HomeOfficeFacts | null> {
  const snapshot = await adminDb.collection('user_profiles').doc(uid).collection('settings').doc('homeOffice').get();
  if (!snapshot.exists) return null;
  const data = snapshot.data() ?? {};
  return { officeSqFt: typeof data.officeSqFt === 'number' ? data.officeSqFt : null, totalHomeSqFt: typeof data.totalHomeSqFt === 'number' ? data.totalHomeSqFt : null };
}

/**
 * Best-effort enrichment. Any read failure yields profile-only context so
 * analysis still runs; it never fails a transaction because history was unavailable.
 */
export async function loadTaxpayerContext(uid: string, profile: UserContext, merchant: string | null | undefined, transactionDate: string | null): Promise<TaxpayerAnalysisContext> {
  const [homeOffice, confirmed] = await Promise.all([
    loadHomeOfficeFacts(uid).catch(() => null),
    loadConfirmedTransactionRecords(uid).then(summarizeConfirmedMerchants).catch(() => [] as ReturnType<typeof summarizeConfirmedMerchants>),
  ]);
  return buildTaxpayerContext({ profile, homeOffice, confirmed, merchant, transactionDate });
}
