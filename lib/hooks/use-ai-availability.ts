'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { auth } from '@/lib/firebase/client';
import { makeAuthenticatedRequest } from '@/lib/firebase/api-client';

export interface AiAvailabilityState {
  status: 'checking' | 'configured' | 'unavailable';
  model: string | null;
  message: string;
}

const checking: AiAvailabilityState = { status: 'checking', model: null, message: 'Checking AI configuration…' };
const signedOut: AiAvailabilityState = { status: 'unavailable', model: null, message: 'Sign in to check AI availability.' };
const failed: AiAvailabilityState = { status: 'unavailable', model: null, message: 'Could not check AI configuration. Please retry the availability check.' };

/** Configuration only: this request never verifies provider funding or runs analysis. */
export async function loadAiAvailability(signal: AbortSignal): Promise<AiAvailabilityState> {
  const response = await makeAuthenticatedRequest('/api/ai/status', { cache: 'no-store', signal });
  if (!response.ok) return response.status === 401 || response.status === 403 ? signedOut : failed;
  const data = await response.json().catch(() => null);
  if (!data || data.provider !== 'openai' || typeof data.model !== 'string' ||
      typeof data.configured !== 'boolean' ||
      (data.configured ? data.reason !== null : !['not_configured', 'disabled'].includes(data.reason))) return failed;
  if (!data.configured) return { status: 'unavailable', model: data.model,
    message: data.reason === 'disabled' ? 'AI analysis is disabled for this environment.' : 'AI analysis is not configured for this environment.' };
  return { status: 'configured', model: data.model,
    message: 'AI is configured. Each analysis still depends on provider availability and usage limits.' };
}

/** Never retain another account's result, and allow an explicit recheck after configuration changes. */
export function useAiAvailability(userId: string | undefined) {
  const [result, setResult] = useState<{ userId: string; state: AiAvailabilityState } | null>(null);
  const activeUser = useRef(userId); activeUser.current = userId;
  const generation = useRef(0);
  const pending = useRef<AbortController | null>(null);

  const refresh = useCallback(async (): Promise<boolean> => {
    if (!userId || activeUser.current !== userId || auth.currentUser?.uid !== userId) return false;
    const request = ++generation.current;
    pending.current?.abort();
    const controller = new AbortController(); pending.current = controller;
    setResult({ userId, state: checking });
    let abort!: () => void;
    const canceled = new Promise<never>((_resolve, reject) => {
      abort = () => reject(new Error('AI configuration check ended'));
      controller.signal.addEventListener('abort', abort, { once: true });
    });
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const isCurrent = () => generation.current === request && activeUser.current === userId && auth.currentUser?.uid === userId;
    try {
      const state = await Promise.race([loadAiAvailability(controller.signal), canceled]);
      if (!isCurrent()) return false;
      setResult({ userId, state });
      return state.status === 'configured';
    } catch {
      if (isCurrent()) setResult({ userId, state: failed });
      return false;
    } finally {
      clearTimeout(timeout);
      controller.signal.removeEventListener('abort', abort);
      if (pending.current === controller) pending.current = null;
    }
  }, [userId]);

  useEffect(() => {
    const requests = generation;
    void refresh();
    return () => { ++requests.current; pending.current?.abort(); pending.current = null; };
  }, [refresh]);

  const state = !userId ? signedOut : result?.userId === userId ? result.state : checking;
  return { ...state, refresh };
}
