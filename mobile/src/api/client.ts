import { API_BASE_URL } from '../config';
import { currentIdToken } from '../auth/firebase';

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
  }
}

/** The web API accepts Firebase ID tokens; no cookies or origin headers are needed from native clients. */
export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await currentIdToken();
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData) && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  const response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });
  const text = await response.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!response.ok) {
    const body = (data ?? {}) as { error?: string; code?: string };
    throw new ApiError(body.error || `Request failed (${response.status})`, response.status, body.code);
  }
  return data as T;
}

export interface MileageTripInput {
  userId: string;
  date: string;
  startLocation: string;
  endLocation: string;
  miles: number;
  businessPurpose: string;
  roundTrip: boolean;
}

export function saveMileageTrip(input: MileageTripInput) {
  return apiRequest<{ id: string }>('/api/mileage', { method: 'POST', body: JSON.stringify(input) });
}

export interface ReceiptOcrResult {
  success: boolean;
  mode: 'ocr';
  ocrResult: { merchant: string; amount: number; date: string; category: string; confidence: number };
  matchCandidates: Array<{ trans_id: string; merchant_name: string; amount: number; date: string; confidence: number }>;
}

/** OCR-only pass: the user reviews merchant, amount and date before anything is saved. */
export async function scanReceipt(fileUri: string, mimeType: string): Promise<ReceiptOcrResult> {
  const form = new FormData();
  form.append('mode', 'ocr');
  // React Native's FormData accepts a file descriptor object for local URIs.
  form.append('file', { uri: fileUri, name: 'receipt.jpg', type: mimeType } as unknown as Blob);
  return apiRequest<ReceiptOcrResult>('/api/receipts/process', { method: 'POST', body: form });
}

export interface ReceiptCommitInput {
  merchant: string;
  amount: string;
  date: string;
  category: string;
  receiptType: 'expense' | 'income';
}

export async function commitReceipt(fileUri: string, mimeType: string, input: ReceiptCommitInput) {
  const form = new FormData();
  form.append('mode', 'commit');
  form.append('receiptType', input.receiptType);
  form.append('receiptData', JSON.stringify({ merchant: input.merchant, amount: input.amount, date: input.date, category: input.category }));
  form.append('file', { uri: fileUri, name: 'receipt.jpg', type: mimeType } as unknown as Blob);
  return apiRequest<{ success: boolean; transaction: { trans_id: string } }>('/api/receipts/process', { method: 'POST', body: form });
}
