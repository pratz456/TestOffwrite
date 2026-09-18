'use client';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { makeAuthenticatedRequest } from '@/lib/firebase/api-client';
import { loadColumnSandbox, validateSandboxSession } from '@/lib/tax-filing/column-browser';
interface FilingStatus { available: boolean; environment: 'sandbox' | null; taxYear: number; status: string; message: string; jurisdictions?: { jurisdiction: string; submissionStatus: string }[] }
export function EmbeddedFilingCard({ userId, taxYear }: { userId: string; taxYear: number }) {
  const [status, setStatus] = useState<FilingStatus | null>(null);
  const [error, setError] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const context = `${userId}:${taxYear}`;
  const active = useRef(context); active.current = context;
  const generation = useRef(0);
  const requestId = useRef(0), launching = useRef(false);
  const refresh = useCallback(async () => {
    const request = ++requestId.current;
    setError('');
    try {
      const response = await makeAuthenticatedRequest(`/api/tax/filing?year=${taxYear}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Filing status could not be loaded.');
      if (data.taxYear !== taxYear || typeof data.available !== 'boolean'
        || (data.available && data.environment !== 'sandbox')) throw new Error('Filing status could not be verified.');
      if (request === requestId.current && active.current === context) setStatus(data);
    } catch (e) { if (request === requestId.current && active.current === context) { setStatus(null); setError(e instanceof Error ? e.message : 'Filing status could not be loaded.'); } }
  }, [taxYear, context]);
  useEffect(() => {
    active.current = context; generation.current += 1;
    setStatus(null); setConsent(false); setBusy(false); launching.current = false;
    void refresh();
    return () => { requestId.current += 1; generation.current += 1; active.current = ''; };
  }, [refresh, context]);
  const launch = async () => {
    if (!consent || !status?.available || launching.current || active.current !== context) return;
    const launchGeneration = generation.current;
    const isCurrent = () => active.current === context && generation.current === launchGeneration;
    launching.current = true; setBusy(true); setError('');
    try {
      const response = await makeAuthenticatedRequest('/api/tax/filing', { method: 'POST', body: JSON.stringify({ taxYear, consent: true }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'The filing sandbox could not open.');
      const userUrl = validateSandboxSession(data, taxYear);
      if (!isCurrent()) return;
      const sdk = await loadColumnSandbox();
      if (!isCurrent()) return;
      sdk.openModule({ userUrl, environment: 'sandbox', onClose: () => { if (isCurrent()) void refresh(); } });
    } catch (e) { if (isCurrent()) setError(e instanceof Error ? e.message : 'The filing sandbox could not open.'); }
    finally { if (isCurrent()) { launching.current = false; setBusy(false); } }
  };
  return <section className="space-y-3 rounded-xl border bg-card p-4" aria-label="In-app filing">
    <h2 className="font-semibold">In-app tax filing</h2>
    {status?.available ? <>
      <p className="text-sm font-medium">Filing sandbox · {taxYear} · Test returns only</p>
      <p className="text-sm text-muted-foreground">Review a sample return in Column Tax. This sandbox cannot file an IRS or state return.</p>
      <p className="text-sm">Sandbox return: {status.status.replaceAll('_', ' ')}</p>
      {status.jurisdictions?.map(item => <p className="text-sm" key={item.jurisdiction}>{item.jurisdiction}: {item.submissionStatus.replaceAll('_', ' ')}</p>)}
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} disabled={busy} />I agree to share this test account’s email, an opaque account identifier and verified sign-in security information with Column Tax’s sandbox. No financial records are sent by this connection.</label>
      <Button onClick={launch} disabled={!consent || busy}>{busy ? 'Opening…' : 'Open filing sandbox'}</Button>
      <Button variant="outline" onClick={refresh} disabled={busy}>Refresh filing status</Button>
    </> : <p className="text-sm text-muted-foreground">{status?.message || (error ? 'In-app filing status is unavailable.' : 'Checking filing availability…')}</p>}
    {error && <div role="alert" className="text-sm text-destructive"><p>{error}</p><Button variant="outline" onClick={refresh} disabled={busy}>Retry filing status</Button></div>}
    <p className="text-xs text-muted-foreground">Your tax preparer or filing provider must review the complete return and obtain the required signatures before submission. Exporting records does not file a return.</p>
  </section>;
}
