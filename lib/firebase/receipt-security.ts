import type { NextRequest } from 'next/server';
import { getStorage } from 'firebase-admin/storage';
import { adminApp } from './admin';
import { getAuthenticatedUser } from './api-auth';
import { isTrustedApplicationRequest } from '@/lib/security/request-origin';

export const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;
const MAX_MULTIPART_BYTES = MAX_RECEIPT_BYTES + 128 * 1024;
export const PRIVATE_RECEIPT_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  Vary: 'Cookie, Authorization',
};

export class ReceiptRequestError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
}

/** Firebase Hosting forwards __session; browser receipt links have no Bearer header. */
export async function receiptUser(request: NextRequest): Promise<string | null> {
  const { user } = await getAuthenticatedUser(request);
  return user?.uid ?? null;
}

export function assertReceiptUploadOrigin(request: NextRequest) {
  // An explicit ID token is not automatically attached by another website.
  if (request.headers.get('authorization')) return;
  if (!isTrustedApplicationRequest(request)) {
    throw new ReceiptRequestError('Cross-site uploads are not allowed', 403);
  }
}

/** Bound actual streamed bytes before multipart parsing, even without Content-Length. */
export async function receiptFormData(request: NextRequest): Promise<FormData> {
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.toLowerCase().startsWith('multipart/form-data;')) {
    throw new ReceiptRequestError('A multipart file upload is required', 400);
  }
  if (Number(request.headers.get('content-length')) > MAX_MULTIPART_BYTES) {
    throw new ReceiptRequestError('File too large. The receipt limit is 10 MB.', 413);
  }
  const reader = request.body?.getReader();
  if (!reader) throw new ReceiptRequestError('No file provided', 400);
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_MULTIPART_BYTES) {
        await reader.cancel();
        throw new ReceiptRequestError('File too large. The receipt limit is 10 MB.', 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return await new Response(Buffer.concat(chunks), { headers: { 'content-type': contentType } }).formData();
  } catch {
    throw new ReceiptRequestError('Invalid multipart upload', 400);
  }
}

export function receiptMimeType(type: unknown): string | null {
  if (type === 'image/jpg') return 'image/jpeg';
  return typeof type === 'string' && ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'].includes(type) ? type : null;
}

/** Signature checks reject mislabeled active content; they do not replace malware scanning. */
export function receiptSignatureMatches(bytes: Buffer, type: string): boolean {
  if (!bytes.length || bytes.length > MAX_RECEIPT_BYTES) return false;
  switch (type) {
    case 'image/jpeg': return bytes.length >= 4 && bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
    case 'image/png': return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    case 'image/gif': return ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii'));
    case 'image/webp': return bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
    case 'application/pdf': return bytes.subarray(0, 5).toString('ascii') === '%PDF-';
    default: return false;
  }
}

export function safeReceiptName(name: unknown): string {
  return (typeof name === 'string' ? name : 'receipt').replace(/[\x00-\x1f\x7f"\\/]/g, '_').slice(0, 255) || 'receipt';
}

export function receiptBucket() {
  // Firebase Hosting may initialize only its named "firebase-frameworks" app.
  const storage = getStorage(adminApp);
  let firebaseConfigBucket: unknown;
  try {
    firebaseConfigBucket = JSON.parse(process.env.FIREBASE_CONFIG || '{}').storageBucket;
  } catch {
    // File-based FIREBASE_CONFIG is handled by Admin initialization/app.options.
  }
  const name = process.env.FIREBASE_STORAGE_BUCKET || process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
    || storage.app.options.storageBucket || (typeof firebaseConfigBucket === 'string' ? firebaseConfigBucket : undefined);
  // A testing project must never silently use the production bucket.
  if (!name) throw new ReceiptRequestError('Receipt storage is not configured. Please contact support.', 503);
  return storage.bucket(name);
}
