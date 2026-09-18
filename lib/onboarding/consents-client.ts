'use client';

import { makeAuthenticatedRequest } from '@/lib/firebase/api-client';
import type { ConsentRecord } from './consents';

export const CONSENT_SAVE_ERROR = 'We could not save your acknowledgments. Check your connection and try again.';

/** Records acknowledgments on the profile through the server allowlist, never the client SDK. */
export async function persistConsentRecord(record: ConsentRecord): Promise<void> {
  let response: Response;
  try {
    response = await makeAuthenticatedRequest('/api/database/profiles', { method: 'POST', body: JSON.stringify({ consents: record }) });
  } catch {
    throw new Error(CONSENT_SAVE_ERROR);
  }
  if (!response.ok) throw new Error(CONSENT_SAVE_ERROR);
}
