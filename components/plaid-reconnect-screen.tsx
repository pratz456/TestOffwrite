'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { PlaidLinkScreen } from '@/components/plaid-link-screen';
import { makeAuthenticatedRequest } from '@/lib/firebase/api-client';
import { auth } from '@/lib/firebase/client';
import type { ReconnectAction, ReconnectAccount, ReconnectDecision, ReconnectRecord, ReconnectView } from '@/lib/plaid/reconnect-contract';

function accountLabel(account: ReconnectAccount) {
  return `${account.name}${account.mask ? ` · ••${account.mask}` : ''} · ${account.type}${account.currency ? ` · ${account.currency}` : ''}`;
}
function amountLabel(amount: number, currency: string | null) {
  if (currency) {
    try { return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount); } catch { /* Show the supplied currency if unsupported. */ }
  }
  return `${amount.toFixed(2)} ${currency || '(currency unavailable)'}`;
}

/** A decision always includes the exact record version that the owner reviewed. */
export function ReconnectRecordReview({ record, accountName, legacyAccountNames = {}, disabled, onDecision }: {
  record: ReconnectRecord; accountName: string; legacyAccountNames?: Record<string, string>; disabled: boolean; onDecision: (decision: ReconnectDecision) => Promise<void>;
}) {
  const [selected, setSelected] = useState('');
  const [confirmedDifference, setConfirmedDifference] = useState(false);
  const candidates = record.canApplyCorrection ? [] : record.candidates;
  const candidateFingerprint = candidates.map(item => `${item.reference}:${item.version}`).join('|');
  useEffect(() => { setSelected(''); setConfirmedDifference(false); }, [record.id, record.version, record.previousRecord?.version, candidateFingerprint]);
  const candidate = candidates.find(item => item.reference === selected);
  const choose = (decision: ReconnectDecision['decision']) => onDecision({ recordId: record.id, version: record.version, decision,
    ...(record.previousRecord ? { previousVersion: record.previousRecord.version } : {}),
    ...(decision === 'duplicate' && candidate ? { canonicalReference: candidate.reference, canonicalVersion: candidate.version,
      ...(!candidate.exact ? { confirmDifferentDetails: confirmedDifference } : {}) } : {}),
  });
  return <Card className="space-y-4 p-4 sm:p-5">
    {record.correction && <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Bank now reports</p>}
    <div className="flex flex-wrap justify-between gap-2">
      <div><h3 className="font-semibold">{record.merchant || 'Bank transaction'}</h3><p className="text-sm text-muted-foreground">{record.date} · {accountName}</p></div>
      <div className="text-right"><p className="font-semibold tabular-nums">{amountLabel(record.amount, record.currency)}</p><p className="text-xs text-muted-foreground">{record.status === 'deferred' ? 'Set aside for later' : 'Needs your decision'}</p></div>
    </div>
    {record.correction && <p className="rounded-md bg-amber-500/10 p-3 text-sm">The bank {record.event === 'removed' ? 'removed this transaction' : 'changed this transaction'} after your earlier decision. Review the change before updating your saved record.</p>}
    {record.previousRecord && <div className="space-y-1 rounded-md border p-3 text-sm"><p className="font-medium">Previously saved</p><p>{record.previousRecord.merchant || 'Saved transaction'} · {amountLabel(record.previousRecord.amount, record.previousRecord.currency)}</p><p className="text-muted-foreground">{record.previousRecord.date} · {record.previousRecord.confirmed ? 'Previously confirmed' : 'Not confirmed'}</p></div>}
    {candidates.length > 0 ? <fieldset className="space-y-2" disabled={disabled}>
      <legend className="mb-2 text-sm font-medium">Is this the same transaction as a saved record?</legend>
      <p className="text-xs text-muted-foreground">Matching details are a suggestion. Nothing is merged automatically.</p>
      {candidates.map(item => <label key={item.reference} className="flex cursor-pointer items-start gap-3 rounded-md border p-3">
        <input type="radio" name={`match-${record.id}`} value={item.reference} checked={selected === item.reference} onChange={() => { setSelected(item.reference); setConfirmedDifference(false); }} className="mt-1" />
        <span className="min-w-0 text-sm"><span className="block font-medium">{item.merchant || 'Saved transaction'} · {amountLabel(item.amount, item.currency)}</span>
          <span className="block text-muted-foreground">{item.date} · {legacyAccountNames[item.accountId] || 'Saved bank account'} · {item.exact ? 'Matching details' : 'Details differ'} · {item.confirmed ? 'Previously confirmed' : 'Not confirmed'}</span></span>
      </label>)}
      {candidate && !candidate.exact && <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmedDifference} onChange={event => setConfirmedDifference(event.target.checked)} className="mt-1" />I reviewed the different date, amount, merchant, or currency and confirm this is the same transaction.</label>}
      <Button variant="outline" disabled={disabled || !candidate || (!candidate.exact && !confirmedDifference)} onClick={() => void choose('duplicate')}>Same transaction · keep saved record</Button>
    </fieldset> : <p className="text-sm text-muted-foreground">{record.correction ? 'Choose whether to keep your prior saved record or apply the bank change, when available.' : 'No possible saved match was found in the accounts you selected. You still choose whether this is a separate transaction.'}</p>}
    {record.status === 'deferred' && <p className="text-xs text-muted-foreground">{record.correction ? 'Your prior saved record stays unchanged while this bank correction is unresolved.' : 'This incoming transaction stays outside your saved transaction totals until you resolve it.'}</p>}
    <div className="flex flex-wrap gap-2">
      {record.correction && <Button variant="outline" disabled={disabled} onClick={() => void choose('keep_existing')}>Keep my saved record unchanged</Button>}
      {record.correction && record.canApplyCorrection && <Button variant="outline" disabled={disabled} onClick={() => void choose('apply_correction')}>{record.event === 'removed' ? 'Apply bank removal' : 'Apply bank change · review classification again'}</Button>}
      {(!record.correction || record.canChooseDistinct) && record.event !== 'removed' && <Button disabled={disabled} onClick={() => void choose('distinct')}>Separate transaction · add to review</Button>}
      <Button variant="ghost" disabled={disabled || record.status === 'deferred'} onClick={() => void choose('defer')}>Decide later</Button>
    </div>
    {record.canApplyCorrection && <p className="text-xs text-muted-foreground">{record.event === 'removed' ? 'Applying this removal marks the saved bank transaction as removed and clears its previous confirmation.' : 'Applying the bank change replaces the saved bank details and requires you to confirm its classification again.'}</p>}
  </Card>;
}

export function PlaidReconnectScreen({ user, sessionId }: { user: { id: string }; sessionId?: string }) {
  const [view, setView] = useState<ReconnectView | null>(null);
  const [loadedOwner, setLoadedOwner] = useState<string | null>(null);
  const [mappings, setMappings] = useState<Record<string, string[]>>({});
  const [confirmMapping, setConfirmMapping] = useState(false);
  const [acknowledgeDeferred, setAcknowledgeDeferred] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const [cancelPrompt, setCancelPrompt] = useState(false);
  const [pageCursors, setPageCursors] = useState<Array<string | null>>([null]);
  const generation = useRef(0);
  const inFlight = useRef(false);
  const latestUser = useRef(user.id);
  latestUser.current = user.id;

  const request = useCallback(async (action?: ReconnectAction, id?: string, cursor?: string | null): Promise<boolean> => {
    if (inFlight.current) return false;
    inFlight.current = true;
    const current = ++generation.current;
    const isCurrent = () => current === generation.current && latestUser.current === user.id && auth.currentUser?.uid === user.id;
    setBusy(true); setError(null);
    try {
      if (auth.currentUser?.uid !== user.id) throw new Error('Sign in again to review this bank history.');
      const query = new URLSearchParams({ ...(id ? { sessionId: id } : {}), ...(cursor ? { cursor } : {}) });
      const response = await makeAuthenticatedRequest(action ? '/api/plaid/reconnect' : `/api/plaid/reconnect?${query}`, {
        ...(action ? { method: 'POST', body: JSON.stringify(action) } : { cache: 'no-store' as const }), signal: AbortSignal.timeout(30_000),
      });
      const data = await response.json().catch(() => null);
      if (!isCurrent()) return false;
      if (!response.ok || !data?.success) throw new Error(data?.error || 'Your bank review could not be loaded. Please refresh and try again.');
      const next = data.reconnect as ReconnectView | undefined;
      const expectedId = action && action.action !== 'start' ? action.sessionId : id;
      if (!next || typeof next.sessionId !== 'string' || (expectedId && next.sessionId !== expectedId) || !Array.isArray(next.accounts) || !Array.isArray(next.records) || !Array.isArray(next.legacyAccounts)) throw new Error('The bank review response could not be verified. Please refresh.');
      setView(next); setLoadedOwner(user.id); setMappings(next.mappings); setConfirmMapping(false); setAcknowledgeDeferred(false);
      if (action) setPageCursors([null]);
      // A reload returns to the same server-owned review, including after activation.
      window.history.replaceState(null, '', `/plaid/reconnect?sessionId=${encodeURIComponent(next.sessionId)}`);
      return true;
    } catch (err) {
      if (current === generation.current && latestUser.current === user.id) setError(err instanceof Error ? err.message : 'Your bank review could not be loaded.');
      return false;
    } finally {
      if (current === generation.current) { setBusy(false); inFlight.current = false; }
    }
  }, [user.id]);

  useEffect(() => {
    inFlight.current = false;
    void request(sessionId ? undefined : { action: 'start' }, sessionId);
    return () => { ++generation.current; inFlight.current = false; };
  }, [request, sessionId]);
  const currentView = loadedOwner === user.id ? view : null;
  const refresh = () => request(undefined, currentView?.sessionId || sessionId).then(ok => { if (ok) setPageCursors([null]); });
  if (linking && currentView?.phase === 'awaiting_link') return <PlaidLinkScreen user={user} fromSettings reconnectSessionId={currentView.sessionId}
    onBack={() => setLinking(false)} onSuccess={() => { setLinking(false); void refresh(); }} />;

  const mappingComplete = !!currentView?.accounts.length && currentView.accounts.every(account => Object.prototype.hasOwnProperty.call(mappings, account.id));
  const mapAccount = (accountId: string, legacyId: string, selected: boolean) => {
    setConfirmMapping(false);
    setMappings(previous => {
      const next = { ...previous };
      const ids = selected ? [...(previous[accountId] || []), legacyId] : (previous[accountId] || []).filter(id => id !== legacyId);
      if (ids.length) next[accountId] = ids; else delete next[accountId];
      return next;
    });
  };
  const act = (action: ReconnectAction) => request(action).then(() => {});
  return <main className="mx-auto max-w-3xl space-y-5 px-4 py-6 sm:px-6">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-semibold">Review saved bank history</h1><p className="mt-1 text-sm text-muted-foreground">Your choices are saved as you go. Return here from Bank accounts at any time.</p></div><Button asChild variant="outline"><Link href="/protected?screen=banks-detail">Return to banks</Link></Button></header>
    {error && <Card role="alert" className="space-y-3 p-4"><p className="text-sm text-destructive">{error}</p><Button variant="outline" disabled={busy} onClick={() => void (currentView || sessionId ? refresh() : request({ action: 'start' }))}>Refresh review</Button></Card>}
    {busy && <p role="status" className="text-sm text-muted-foreground">Saving or loading your bank review…</p>}
    {!currentView && !error && <p role="status">Loading your saved history review…</p>}
    {currentView?.phase === 'awaiting_link' && <Card className="space-y-4 p-5"><h2 className="text-lg font-semibold">1. Connect your bank again</h2><p className="text-sm text-muted-foreground">Then match each new account to your saved accounts and review overlapping transactions. Your existing saved history stays available while you work.</p><Button disabled={busy} onClick={() => setLinking(true)}>Connect bank for history review</Button></Card>}
    {currentView?.phase === 'cancelled' && <Card className="space-y-3 p-5"><h2 className="font-semibold">This reconnect was cancelled</h2><p className="text-sm text-muted-foreground">Your saved transaction history remains available.</p><Button disabled={busy} onClick={() => void act({ action: 'start' })}>Start a new reconnect</Button></Card>}
    {currentView && ['review', 'active'].includes(currentView.phase) && <>
      <Card className="space-y-3 p-5"><h2 className="text-lg font-semibold">{currentView.phase === 'active' ? currentView.pendingCount + currentView.deferredCount > 0 ? 'Bank reconnected · history review remains' : 'Bank reconnected · history review complete' : 'Reconnect in progress'}</h2>
        <p className="text-sm text-muted-foreground">{currentView.pendingCount} need a decision · {currentView.deferredCount} set aside · {currentView.resolvedCount} resolved</p>
        {currentView.phase === 'active' && currentView.deferredCount > 0 && <p className="text-sm">You can continue reviewing the records you set aside below.</p>}
        {!currentView.historyReady && <p className="text-sm">Your bank is still preparing transaction history. Check for bank updates before activating the connection.</p>}
        <Button variant="outline" disabled={busy} onClick={() => void act({ action: 'sync', sessionId: currentView.sessionId })}>Check for bank updates</Button>
      </Card>
      {!currentView.mappingComplete && <Card className="space-y-4 p-5"><h2 className="text-lg font-semibold">2. Match your accounts</h2><p className="text-sm text-muted-foreground">For each newly connected account, select all saved accounts that represent the same bank account. Select “different account” only if none match.</p>
        {currentView.accounts.map(account => <fieldset key={account.id} disabled={busy} className="space-y-2 rounded-lg border p-4"><legend className="px-1 text-sm font-semibold">{accountLabel(account)}</legend>
          {currentView.legacyAccounts.map(legacy => <label key={legacy.id} className="flex items-start gap-2 text-sm"><input type="checkbox" checked={(mappings[account.id] || []).includes(legacy.id)} onChange={event => mapAccount(account.id, legacy.id, event.target.checked)} className="mt-1" />{accountLabel(legacy)}</label>)}
          <label className="flex items-start gap-2 border-t pt-2 text-sm"><input type="checkbox" checked={Array.isArray(mappings[account.id]) && mappings[account.id].length === 0} onChange={event => { setConfirmMapping(false); setMappings(previous => { const next = { ...previous }; if (event.target.checked) next[account.id] = []; else delete next[account.id]; return next; }); }} className="mt-1" />This is a different account from every saved account listed above.</label>
        </fieldset>)}
        {!currentView.accounts.length && <p className="text-sm">Waiting for the bank’s accounts. Check for bank updates above.</p>}
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmMapping} disabled={busy || !mappingComplete} onChange={event => setConfirmMapping(event.target.checked)} className="mt-1" />I checked every account and confirm these account matches.</label>
        <Button disabled={busy || !mappingComplete || !confirmMapping} onClick={() => void act({ action: 'map', sessionId: currentView.sessionId, mappings, confirmAccountMapping: true })}>Confirm account matches</Button>
      </Card>}
      {currentView.mappingComplete && <section className="space-y-3" aria-label="Transaction history review"><h2 className="text-lg font-semibold">3. Review overlapping history</h2><p className="text-sm text-muted-foreground">Choose “same transaction” to preserve a saved record, “separate transaction” to add it to review, or “decide later” to leave it unresolved.</p>
        {currentView.records.filter(record => record.status !== 'resolved').map(record => <ReconnectRecordReview key={`${record.id}:${record.version}:${record.status}`} record={record} legacyAccountNames={Object.fromEntries(currentView.legacyAccounts.map(account => [account.id, accountLabel(account)]))} accountName={currentView.accounts.find(account => account.id === record.accountId)?.name || 'Bank account'} disabled={busy} onDecision={decision => act({ action: 'decide', sessionId: currentView.sessionId, decisions: [decision] })} />)}
        {!currentView.records.length && <p className="rounded-md border p-4 text-sm">{currentView.pendingCount + currentView.deferredCount === 0 ? 'No history records need a decision right now.' : 'No records on this page. Return to the first page or refresh the review.'}</p>}
        <nav className="flex flex-wrap items-center gap-3" aria-label="History review pages">
          <Button variant="outline" disabled={busy || pageCursors.length === 1} onClick={() => void refresh()}>First page</Button><span className="text-sm">Page {pageCursors.length}</span>
          <Button variant="outline" disabled={busy || !currentView.nextCursor} onClick={async () => { const cursor = currentView.nextCursor; if (cursor && await request(undefined, currentView.sessionId, cursor)) setPageCursors(previous => [...previous, cursor]); }}>Next page</Button>
        </nav><p className="text-xs text-muted-foreground">After saving a decision, the first page of remaining records is shown.</p>
      </section>}
      {currentView.phase === 'review' && <Card className="space-y-4 p-5"><h2 className="text-lg font-semibold">4. Resume bank updates</h2><p className="text-sm text-muted-foreground">Finish matching accounts and make a decision on each pending record before activating the connection.</p>
        {currentView.deferredCount > 0 && <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={acknowledgeDeferred} disabled={busy} onChange={event => setAcknowledgeDeferred(event.target.checked)} className="mt-1" />I understand that {currentView.deferredCount} records remain unresolved. I will return to review them later.</label>}
        <Button disabled={busy || !currentView.historyReady || !currentView.mappingComplete || currentView.pendingCount > 0 || (currentView.deferredCount > 0 && !acknowledgeDeferred)} onClick={() => void act({ action: 'activate', sessionId: currentView.sessionId, acknowledgeDeferred })}>Activate bank connection</Button>
      </Card>}
    </>}
    {currentView && currentView.phase !== 'active' && currentView.phase !== 'cancelled' && <Button variant="ghost" disabled={busy} onClick={() => setCancelPrompt(true)}>Cancel this reconnect</Button>}
    <ConfirmationDialog open={cancelPrompt} onOpenChange={setCancelPrompt} title="Cancel this reconnect?" description="This ends this reconnect attempt. Your existing saved transaction history stays available." confirmLabel="Cancel reconnect" variant="destructive" onConfirm={() => { setCancelPrompt(false); if (currentView) void act({ action: 'cancel', sessionId: currentView.sessionId }); }} />
  </main>;
}
