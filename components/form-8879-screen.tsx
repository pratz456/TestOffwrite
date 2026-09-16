'use client';
import React, { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { SUPPORTED_TAX_YEARS } from '@/lib/tax-rules/federal-year-rules';
import { makeAuthenticatedRequest } from '@/lib/firebase/api-client';
interface Props { user: { id: string; email?: string }; onBack: () => void; onNavigate?: (screen: string) => void }

/** Historical app consents must never be presented as a provider/IRS signature. */
export function Form8879Screen({ user, onBack, onNavigate }: Props) {
  const [year, setYear] = useState(String(SUPPORTED_TAX_YEARS.at(-1)));
  const [legacy, setLegacy] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const requestId = useRef(0);
  useEffect(() => {
    const current = ++requestId.current;
    setLegacy(false); setError('');
    void makeAuthenticatedRequest(`/api/tax/form-8879?year=${year}`).then(async response => {
      if (!response.ok) throw new Error('Unable to load the historical record.');
      const data = await response.json();
      if (current === requestId.current) setLegacy(data.legacyRecordExists === true);
    }).catch(() => { if (current === requestId.current) setError('Unable to load the historical record. Please retry.'); });
    return () => { requestId.current += 1; };
  }, [year, user.id, attempt]);
  return <main className="mx-auto max-w-2xl space-y-5 p-5">
    <Button variant="outline" onClick={onBack}>Back</Button>
    <h1 className="text-2xl font-semibold">Filing authorization</h1>
    <p>Review and sign your completed return in your authorized filing provider. WriteOff planning summaries and old authorization records do not file a tax return.</p>
    <section className="space-y-3 rounded-xl border p-4">
      <h2 className="font-semibold">About Form 8879</h2>
      <p className="text-sm text-muted-foreground">An electronic return originator may use Form 8879 to obtain your authorization for a completed return. The provider determines the applicable signature method and handles identity checks. Do not enter an e-file PIN in WriteOff.</p>
      <a className="text-sm underline" href="https://www.irs.gov/forms-pubs/about-form-8879" target="_blank" rel="noopener noreferrer">IRS Form 8879 information</a>
    </section>
    <label className="block text-sm">Historical record year <select aria-label="Historical record year" className="ml-2 rounded border p-2" value={year} onChange={event => setYear(event.target.value)}>{[...SUPPORTED_TAX_YEARS].reverse().map(value => <option key={value} value={value}>{value}</option>)}</select></label>
    {legacy && <p role="status" className="rounded border p-3 text-sm">An older WriteOff authorization record exists for {year}. It has been preserved for reference. It is not confirmation that a provider signed, submitted or filed your return.</p>}
    {error && <div role="alert"><p>{error}</p><Button variant="outline" onClick={() => setAttempt(value => value + 1)}>Retry historical record</Button></div>}
    <Button onClick={() => onNavigate?.('tax-filing-hub')}>Open tax filing and exports</Button>
  </main>;
}
export default Form8879Screen;
