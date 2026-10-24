'use client';

import { useEffect, useState } from 'react';
import { makeAuthenticatedRequest } from '@/lib/firebase/api-client';
import { MODEL_CONSENT_UNAVAILABLE, type ConsentStatus } from '@/lib/openai/consent-contract';

export { MODEL_CONSENT_UNAVAILABLE };

export type ModelConsentStatus = ConsentStatus | 'unknown';

export interface ModelConsentSnapshot {
  status: ModelConsentStatus;
  purposes: string[];
  signedAt: string | null;
  expiresAt: string | null;
  timeZone: string | null;
  reuse: { status: ModelConsentStatus; purposes: string[] };
}

const unknownReuse = { status: 'unknown' as const, purposes: [] as string[] };

export function unknownModelConsent(): ModelConsentSnapshot {
  return { status: 'unknown', purposes: [], signedAt: null, expiresAt: null, timeZone: null, reuse: unknownReuse };
}

function readStatus(value: unknown): ModelConsentStatus {
  return value === 'granted' || value === 'withdrawn' || value === 'declined' ? value : 'declined';
}

/** Maps the settings GET body. A failed read is declined. */
export function modelConsentFromResponse(ok: boolean, body: unknown): ModelConsentSnapshot {
  const record = ok && body && typeof body === 'object' ? body as Record<string, unknown> : null;
  if (!record) {
    return { status: 'declined', purposes: [], signedAt: null, expiresAt: null, timeZone: null, reuse: { status: 'declined', purposes: [] } };
  }
  const reuse = record.reuse && typeof record.reuse === 'object' ? record.reuse as Record<string, unknown> : null;
  return {
    status: readStatus(record.status),
    purposes: Array.isArray(record.purposes) ? record.purposes.filter((item): item is string => typeof item === 'string') : [],
    signedAt: typeof record.signedAt === 'string' ? record.signedAt : null,
    expiresAt: typeof record.expiresAt === 'string' ? record.expiresAt : null,
    timeZone: typeof record.timeZone === 'string' ? record.timeZone : null,
    reuse: {
      status: reuse ? readStatus(reuse.status) : 'declined',
      purposes: Array.isArray(reuse?.purposes) ? reuse.purposes.filter((item): item is string => typeof item === 'string') : [],
    },
  };
}

export async function loadModelConsent(request: typeof makeAuthenticatedRequest = makeAuthenticatedRequest): Promise<ModelConsentSnapshot> {
  try {
    const response = await request('/api/settings/model-consent');
    const body = await response.json().catch(() => null);
    return modelConsentFromResponse(response.ok, body);
  } catch {
    return modelConsentFromResponse(false, null);
  }
}

/** Fail closed: uploads stay hidden until a granted disclosure is loaded. */
export function useModelConsent() {
  const [snapshot, setSnapshot] = useState<ModelConsentSnapshot>(unknownModelConsent);
  useEffect(() => {
    let cancel = false;
    loadModelConsent().then(next => { if (!cancel) setSnapshot(next); });
    return () => { cancel = true; };
  }, []);
  return { ...snapshot, granted: snapshot.status === 'granted', loaded: snapshot.status !== 'unknown' };
}
