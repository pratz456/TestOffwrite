export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { adminDb } from '@/lib/firebase/admin';
import { getTransactionServer } from '@/lib/firebase/transactions-server';
import {
  assertReceiptUploadOrigin, MAX_RECEIPT_BYTES, PRIVATE_RECEIPT_HEADERS,
  receiptBucket, receiptFormData, receiptMimeType, ReceiptRequestError,
  receiptSignatureMatches, receiptUser, safeReceiptName,
} from '@/lib/firebase/receipt-security';
import { enforceRateLimit, RATE_LIMITS, rateLimitResponse } from '@/lib/security/rate-limit';

export async function POST(request: NextRequest) {
  const userId = await receiptUser(request);
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: PRIVATE_RECEIPT_HEADERS });

  try {
    assertReceiptUploadOrigin(request);
    // Durable per-owner bound before the multipart body is read or Storage is touched.
    const limit = await enforceRateLimit({ ...RATE_LIMITS.receiptUpload, key: userId });
    if (!limit.allowed) return rateLimitResponse(limit, { headers: PRIVATE_RECEIPT_HEADERS, error: 'Too many receipt uploads. Please wait a few minutes and try again.' });
    const formData = await receiptFormData(request);
    const files = formData.getAll('file');
    const transactionId = formData.get('transactionId');
    if (files.length !== 1 || !(files[0] instanceof File)) {
      throw new ReceiptRequestError('Provide one receipt file', 400);
    }
    if (typeof transactionId !== 'string' || !transactionId.trim() || transactionId.length > 256 || /[\/\\\x00-\x1f\x7f]/.test(transactionId)) {
      throw new ReceiptRequestError('A valid transaction ID is required', 400);
    }
    const file = files[0];
    const mimeType = receiptMimeType(file.type);
    if (!mimeType) throw new ReceiptRequestError('Upload a JPG, PNG, GIF, WebP or PDF receipt', 400);
    if (!file.size || file.size > MAX_RECEIPT_BYTES) {
      throw new ReceiptRequestError('Upload a non-empty receipt of at most 10 MB', file.size ? 413 : 400);
    }

    // Both supported owner fields are queried by this helper. Client-supplied userId is ignored.
    const { data: transaction, error } = await getTransactionServer(userId, transactionId);
    if (error) throw new ReceiptRequestError('Unable to verify the transaction. Please retry.', 503);
    if (!transaction) throw new ReceiptRequestError('Transaction not found', 404);

    const bytes = Buffer.from(await file.arrayBuffer());
    if (!receiptSignatureMatches(bytes, mimeType)) throw new ReceiptRequestError('The receipt content does not match its file type', 400);
    const receiptId = randomUUID();
    const storagePath = `receipts/${userId}/${transactionId}/${receiptId}`;
    const originalName = safeReceiptName(file.name);
    const storedFile = receiptBucket().file(storagePath);
    await storedFile.save(bytes, {
      resumable: false,
      validation: 'crc32c',
      metadata: { contentType: mimeType, cacheControl: PRIVATE_RECEIPT_HEADERS['Cache-Control'] },
    });
    try {
      // Bytes belong in Storage, not Firestore's 1 MiB documents. IDs stay one URL segment.
      await adminDb.collection('receipts').doc(receiptId).create({
        transactionId, userId, filename: originalName, originalName,
        mimeType, size: bytes.length, storagePath, uploadedAt: new Date(),
      });
    } catch (error) {
      await storedFile.delete({ ignoreNotFound: true }).catch(() => undefined);
      throw error;
    }
    return NextResponse.json({
      success: true, receiptUrl: `/api/receipts/${receiptId}`, filename: originalName, size: bytes.length,
    }, { headers: PRIVATE_RECEIPT_HEADERS });
  } catch (error) {
    const status = error instanceof ReceiptRequestError ? error.status : 500;
    return NextResponse.json({ error: error instanceof ReceiptRequestError ? error.message : 'Failed to upload receipt. Please retry.' }, { status, headers: PRIVATE_RECEIPT_HEADERS });
  }
}
