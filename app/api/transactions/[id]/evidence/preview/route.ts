import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { getTransactionServer } from '@/lib/firebase/transactions-server';
import { transactionIdInput } from '@/lib/transactions/client-updates';
import { assertReceiptUploadOrigin, PRIVATE_RECEIPT_HEADERS, receiptFormData, ReceiptRequestError } from '@/lib/firebase/receipt-security';
import { enforceRateLimit, rateLimitResponse } from '@/lib/security/rate-limit';
import { EvidenceImportError, previewCalendarEvidence, previewEmailEvidence } from '@/lib/evidence/parse';
import { MAX_CALENDAR_EVIDENCE_BYTES, MAX_EMAIL_EVIDENCE_BYTES } from '@/lib/evidence/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const response = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: PRIVATE_RECEIPT_HEADERS });

/** Preview only: no Storage/database writes, model calls, inbox access or calendar access. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user, error } = await getAuthenticatedUser(request);
    if (error || !user) return response({ error: 'Unauthorized' }, 401);
    assertReceiptUploadOrigin(request);
    const { id } = await params;
    if (!transactionIdInput.safeParse(id).success) return response({ error: 'Invalid transaction ID' }, 400);
    const result = await getTransactionServer(user.uid, id);
    if (result.error) return response({ error: 'Could not verify this transaction. Please retry.' }, 503);
    if (!result.data || [result.data.userId, result.data.user_id].some(owner => owner != null && owner !== user.uid)) return response({ error: 'Transaction not found' }, 404);
    const limit = await enforceRateLimit({ scope: 'evidence.preview', key: user.uid, limit: 20, windowMs: 10 * 60_000, onUnavailable: 'deny' });
    if (!limit.allowed) return rateLimitResponse(limit, { headers: PRIVATE_RECEIPT_HEADERS, error: 'Too many evidence previews. Please try again shortly.' });
    const form = await receiptFormData(request);
    if ([...form.keys()].some(key => key !== 'file')) return response({ error: 'Provide only the selected evidence file.' }, 400);
    const files = form.getAll('file');
    if (files.length !== 1 || !(files[0] instanceof File)) return response({ error: 'Choose one email or calendar file.' }, 400);
    const file = files[0];
    const calendar = /\.ics$/i.test(file.name);
    if (!calendar && !/\.eml$/i.test(file.name)) return response({ error: 'Choose an .eml email or .ics calendar file.' }, 400);
    if (!file.size || file.size > (calendar ? MAX_CALENDAR_EVIDENCE_BYTES : MAX_EMAIL_EVIDENCE_BYTES)) return response({ error: calendar ? 'Calendar files must be between 1 byte and 1 MB.' : 'Email files must be between 1 byte and 8 MB.' }, 413);
    const bytes = Buffer.from(await file.arrayBuffer());
    return response(calendar ? previewCalendarEvidence(bytes) : await previewEmailEvidence(bytes));
  } catch (error) {
    if (error instanceof EvidenceImportError || error instanceof ReceiptRequestError) return response({ error: error.message }, error.status);
    return response({ error: 'Could not preview this file. Export it again and retry.' }, 500);
  }
}
