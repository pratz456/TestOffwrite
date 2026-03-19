export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import type { DocumentReference } from 'firebase-admin/firestore';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { adminDb, FieldValue } from '@/lib/firebase/admin';

type Scope = 'learning_only' | 'unreviewed_tax_labels';

/**
 * POST /api/transactions/reset-unreviewed-classifications
 *
 * One-time cleanup for transactions classified before import stopped auto-applying
 * tax treatment. Does not touch rows where the user already left a classification reason.
 *
 * - learning_only: only rows tagged auto_classified / auto_classified_source (safest).
 * - unreviewed_tax_labels: any row with business/personal set but no user_classification_reason
 *   (requires confirm: true — may include manual entries that never set a reason).
 */
export async function POST(request: NextRequest) {
  const { user, error: authError } = await getAuthenticatedUser(request);
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { scope?: Scope; confirm?: boolean } = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const scope: Scope = body.scope === 'unreviewed_tax_labels' ? 'unreviewed_tax_labels' : 'learning_only';

  if (scope === 'unreviewed_tax_labels' && body.confirm !== true) {
    return NextResponse.json(
      {
        error: 'Set confirm: true to reset all unreviewed tax labels (see API comment).',
        scope,
      },
      { status: 400 }
    );
  }

  const uid = user.uid;
  const accountsSnap = await adminDb.collection('user_profiles').doc(uid).collection('accounts').get();

  let resetCount = 0;
  const batchLimit = 450;
  let batch = adminDb.batch();
  let batchOps = 0;

  const commitBatch = async () => {
    if (batchOps === 0) return;
    await batch.commit();
    batch = adminDb.batch();
    batchOps = 0;
  };

  const scheduleUpdate = async (ref: DocumentReference) => {
    batch.update(ref, {
      is_deductible: null,
      expense_type: null,
      auto_classified: FieldValue.delete(),
      auto_classified_source: FieldValue.delete(),
      deductionStatus: FieldValue.delete(),
      updated_at: new Date(),
      updatedAt: Date.now(),
    });
    batchOps++;
    resetCount++;
    if (batchOps >= batchLimit) {
      await commitBatch();
    }
  };

  for (const accDoc of accountsSnap.docs) {
    const txSnap = await accDoc.ref.collection('transactions').get();
    for (const doc of txSnap.docs) {
      const d = doc.data() as Record<string, unknown>;
      const hasUserReason =
        d.user_classification_reason != null && String(d.user_classification_reason).trim() !== '';
      if (hasUserReason) continue;

      let match = false;
      if (scope === 'learning_only') {
        match = d.auto_classified === true || d.auto_classified_source != null;
      } else {
        const id = d.is_deductible;
        match = id === true || id === false;
      }

      if (match) {
        await scheduleUpdate(doc.ref);
      }
    }
  }

  await commitBatch();

  return NextResponse.json({
    success: true,
    scope,
    resetCount,
    message:
      scope === 'learning_only'
        ? 'Reset tax labels for learning-auto-classified imports only.'
        : 'Reset tax labels for all transactions without a user classification reason.',
  });
}
