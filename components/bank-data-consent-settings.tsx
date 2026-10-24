'use client';

import React, { useEffect, useState } from 'react';
import { Landmark, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { makeAuthenticatedRequest } from '@/lib/firebase/api-client';
import {
  BANK_CONSENT_SAVE_ERROR, BANK_CONSENT_SCREEN_TITLE, BANK_CONSENT_STATUS_ABSENT, BANK_CONSENT_STATUS_GRANTED, BANK_CONSENT_WITHDRAW, BANK_CONSENT_WITHDRAW_BODY,
} from '@/lib/onboarding/bank-consent-copy';

interface BankDataConsentSettingsProps {
  userId: string;
}

/** Settings control for the later bank grant. Withdrawal does not delete saved transactions. */
export function BankDataConsentSettings({ userId }: BankDataConsentSettingsProps) {
  const [bankData, setBankData] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    makeAuthenticatedRequest('/api/settings/bank-consent')
      .then(async response => {
        if (!response.ok) return;
        const data = await response.json();
        if (!cancelled) setBankData(data.bank_data === true);
      })
      .catch(() => undefined)
      .finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, [userId]);

  const withdraw = async () => {
    if (!bankData || withdrawing) return;
    setWithdrawing(true);
    setMessage(null);
    try {
      const response = await makeAuthenticatedRequest('/api/settings/bank-consent', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'withdraw' }),
      });
      if (!response.ok) throw new Error(BANK_CONSENT_SAVE_ERROR);
      setBankData(false);
      setMessage({ tone: 'ok', text: BANK_CONSENT_WITHDRAW_BODY });
    } catch (cause) {
      setMessage({ tone: 'error', text: cause instanceof Error && cause.message ? cause.message : BANK_CONSENT_SAVE_ERROR });
    } finally {
      setWithdrawing(false);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
      <p className="flex items-center gap-2 text-sm font-medium text-foreground"><Landmark className="h-4 w-4" />{BANK_CONSENT_SCREEN_TITLE}</p>
      {!loaded ? (
        <p className="text-xs text-muted-foreground">{BANK_CONSENT_STATUS_ABSENT}</p>
      ) : bankData ? (
        <>
          <p className="text-xs text-muted-foreground">{BANK_CONSENT_STATUS_GRANTED} {BANK_CONSENT_WITHDRAW_BODY}</p>
          <Button type="button" variant="outline" size="sm" disabled={withdrawing} onClick={withdraw} className="gap-2">
            {withdrawing && <Loader2 className="h-4 w-4 animate-spin" />}{BANK_CONSENT_WITHDRAW}
          </Button>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">{BANK_CONSENT_STATUS_ABSENT}</p>
      )}
      {message && <p role={message.tone === 'error' ? 'alert' : 'status'} className={`text-xs ${message.tone === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}>{message.text}</p>}
    </div>
  );
}
