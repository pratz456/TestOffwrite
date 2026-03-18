export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase/admin';

/**
 * Column Tax webhook handler.
 *
 * Column Tax sends POST requests here when filing status changes.
 * In production you should verify the webhook signature using a shared
 * secret (COLUMN_TAX_WEBHOOK_SECRET). For now we accept the payload
 * and update Firestore.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const { event, taxpayer_id, external_id, status, tax_year } = body as {
      event?: string;
      taxpayer_id?: string;
      external_id?: string;
      status?: string;
      tax_year?: number;
    };

    if (!external_id && !taxpayer_id) {
      return NextResponse.json(
        { error: 'Missing taxpayer identifier' },
        { status: 400 },
      );
    }

    let uid = external_id;

    if (!uid && taxpayer_id) {
      const snap = await adminDb
        .collection('user_profiles')
        .where('columnTaxTaxpayerId', '==', taxpayer_id)
        .limit(1)
        .get();

      if (!snap.empty) {
        uid = snap.docs[0].id;
      }
    }

    if (!uid) {
      console.warn('[Column Tax Webhook] Could not resolve user for taxpayer:', taxpayer_id);
      return NextResponse.json({ received: true, matched: false });
    }

    const validStatuses = ['draft', 'submitted', 'accepted', 'rejected'];
    const normalizedStatus = validStatuses.includes(status || '')
      ? status
      : undefined;

    const updateData: Record<string, unknown> = {
      columnTaxLastSyncedAt: new Date(),
    };

    if (normalizedStatus) {
      updateData.columnTaxFilingStatus = normalizedStatus;
    }
    if (tax_year) {
      updateData.columnTaxFilingYear = tax_year;
    }

    await adminDb.collection('user_profiles').doc(uid).update(updateData);

    console.log(
      `[Column Tax Webhook] Updated user ${uid}: event=${event}, status=${normalizedStatus}`,
    );

    return NextResponse.json({ received: true, matched: true });
  } catch (error) {
    console.error('[Column Tax Webhook] Error:', error);
    return NextResponse.json(
      { error: 'Webhook processing failed' },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json({ status: 'ok', service: 'column-tax-webhook' });
}
