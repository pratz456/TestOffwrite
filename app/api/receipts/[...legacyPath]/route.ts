export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { GET as getReceipt } from '../[filename]/route';
import { PRIVATE_RECEIPT_HEADERS } from '@/lib/firebase/receipt-security';

/** Old uploads saved receipts/{uid}/{transactionId}/{filename} Firestore records. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ legacyPath: string[] }> }) {
  const { legacyPath } = await params;
  if (!Array.isArray(legacyPath) || legacyPath.length !== 3) {
    return NextResponse.json({ error: 'Receipt not found' }, { status: 404, headers: PRIVATE_RECEIPT_HEADERS });
  }
  // The shared handler authenticates first, checks the UID path and stored owner,
  // and serves the same private response. No migration or database write occurs.
  return getReceipt(request, { params: Promise.resolve({ filename: legacyPath.join('/') }) });
}
