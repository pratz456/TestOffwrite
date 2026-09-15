export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase/admin';
import {
  MAX_RECEIPT_BYTES, PRIVATE_RECEIPT_HEADERS, receiptBucket, receiptMimeType,
  receiptSignatureMatches, receiptUser, safeReceiptName,
} from '@/lib/firebase/receipt-security';

function notFound() {
  return NextResponse.json({ error: 'Receipt not found' }, { status: 404, headers: PRIVATE_RECEIPT_HEADERS });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ filename: string }> }) {
  const userId = await receiptUser(request);
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: PRIVATE_RECEIPT_HEADERS });
  try {
    const { filename } = await params;
    if (!filename || filename.length > 600 || /[\\\x00-\x1f\x7f]/.test(filename)) return notFound();
    const parts = filename.split('/');
    // Flat IDs are current. Previously saved nested Firestore IDs are accepted only
    // when URL-encoded as one route segment and rooted in the authenticated user's UID.
    if (parts.some(part => !part || part === '.' || part === '..') || (parts.length !== 1 && (parts.length !== 3 || parts[0] !== userId))) return notFound();
    const receiptDoc = await adminDb.collection('receipts').doc(filename).get();
    const receipt = receiptDoc.data();
    if (!receiptDoc.exists || receipt?.userId !== userId) return notFound();
    const mimeType = receiptMimeType(receipt.mimeType);
    if (!mimeType) return notFound();

    let bytes: Buffer;
    if (typeof receipt.storagePath === 'string') {
      const expectedPrefix = `receipts/${userId}/${receipt.transactionId}/`;
      const storageParts = receipt.storagePath.split('/');
      if (!receipt.storagePath.startsWith(expectedPrefix) || storageParts.length !== 4 || storageParts.some((part: string) => !part || part === '.' || part === '..')) return notFound();
      const storedFile = receiptBucket().file(receipt.storagePath);
      const [metadata] = await storedFile.getMetadata();
      if (!Number.isSafeInteger(Number(metadata.size)) || Number(metadata.size) <= 0 || Number(metadata.size) > MAX_RECEIPT_BYTES) return notFound();
      // Read a bounded range as defense against replacement after the metadata check.
      [bytes] = await storedFile.download({ start: 0, end: MAX_RECEIPT_BYTES });
    } else if (typeof receipt.dataUrl === 'string') {
      // Preserve access to legacy base64 receipts without trusting their content type.
      if (receipt.dataUrl.length > Math.ceil(MAX_RECEIPT_BYTES / 3) * 4 + 64) return notFound();
      const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]+={0,2})$/.exec(receipt.dataUrl);
      if (!match || receiptMimeType(match[1]) !== mimeType) return notFound();
      bytes = Buffer.from(match[2], 'base64');
      if (bytes.toString('base64') !== match[2]) return notFound();
    } else return notFound();

    if (!receiptSignatureMatches(bytes, mimeType)) return notFound();
    const name = encodeURIComponent(safeReceiptName(receipt.originalName)).replace(/['()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        ...PRIVATE_RECEIPT_HEADERS,
        'Content-Type': mimeType,
        'Content-Disposition': `${mimeType === 'application/pdf' ? 'attachment' : 'inline'}; filename="receipt"; filename*=UTF-8''${name}`,
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      },
    });
  } catch {
    return NextResponse.json({ error: 'Unable to retrieve receipt. Please retry.' }, { status: 500, headers: PRIVATE_RECEIPT_HEADERS });
  }
}
