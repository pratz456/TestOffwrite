"use client";

import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, CheckCircle, ChevronRight, Edit3, ExternalLink, FileText, Loader2, RefreshCw, SkipForward, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import type { Transaction } from '@/lib/firebase/transactions';
import { makeAuthenticatedRequest } from '@/lib/firebase/api-client';
import { useAiAvailability } from '@/lib/hooks/use-ai-availability';
import { transactionNeedsCategoryReview, transactionNeedsTaxReview } from '@/lib/utils/transaction-tax-review';
import { REVIEW_CATEGORIES, canConfirmSuggestion, type TransactionKind } from '@/lib/transactions/ai-review-contract';
import { reviewPresentation, transactionReviewKey } from '@/lib/transactions/review-presentation';

interface ReviewTransactionsScreenProps {
  user: { id: string; email?: string; user_metadata?: { name?: string } };
  onBack: () => void;
  transactions: Transaction[];
  onTransactionUpdate: (updatedTransaction: Transaction) => void;
  onTransactionClick?: (transaction: Transaction) => void;
}

const kindLabels: Record<Exclude<TransactionKind, 'unknown'>, string> = {
  expense: 'Business expense', personal: 'Personal purchase', income: 'Business income',
  transfer: 'Transfer / card payment', refund: 'Expense refund',
};

export const ReviewTransactionsScreen: React.FC<ReviewTransactionsScreenProps> = ({
  user, onBack, transactions, onTransactionUpdate, onTransactionClick,
}) => {
  const availability = useAiAvailability(user.id);
  const [reviewed, setReviewed] = useState<Set<string>>(new Set());
  const [deferred, setDeferred] = useState<Set<string>>(new Set());
  const [snapshots, setSnapshots] = useState<Record<string, { transaction: Transaction; baseline: Transaction | undefined }>>({});
  const incomingRecords = useRef(transactions); incomingRecords.current = transactions;
  const [operation, setOperation] = useState<'saving' | 'analyzing' | null>(null);
  const [editing, setEditing] = useState(false);
  const [kind, setKind] = useState<Exclude<TransactionKind, 'unknown'>>('expense');
  const [category, setCategory] = useState('');
  const [deductible, setDeductible] = useState<boolean | null>(null);
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [providerFailed, setProviderFailed] = useState(false);
  const [touchOffset, setTouchOffset] = useState(0);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const operationLock = useRef(false);
  const activeUser = useRef(user.id);
  activeUser.current = user.id;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const correctionHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    setReviewed(new Set()); setDeferred(new Set()); setSnapshots({}); setEditing(false);
    setMessage(null); setProviderFailed(false);
  }, [user.id]);

  const resolved = transactions.map(transaction => {
    const saved = snapshots[transactionReviewKey(transaction)];
    if (!saved) return transaction;
    // A new Firestore snapshot is authoritative, including invalidated or removed AI results.
    return saved.baseline === transaction ? saved.transaction : transaction;
  });
  const remaining = resolved.filter(transaction => transactionNeedsCategoryReview(transaction));
  const taxQuestions = resolved.filter(transaction => !transactionNeedsCategoryReview(transaction) && transactionNeedsTaxReview(transaction));
  const current = remaining.find(transaction => !deferred.has(transactionReviewKey(transaction)));
  const currentKey = current ? transactionReviewKey(current) : '';
  const activeKey = useRef(currentKey);
  activeKey.current = currentKey;
  const presentation = current ? reviewPresentation(current) : null;
  const suggestion = current?.ai_suggestion;
  const analysisRunning = current?.analysisStatus === 'running' || current?.analysis_status === 'running';
  const analysisQueued = !!current?.analysisJobId && (current.analysisStatus === 'pending' || current.analysis_status === 'pending');
  const mayConfirm = !!current && current.pending !== true && !analysisRunning && !analysisQueued && canConfirmSuggestion(suggestion);
  const busy = operation !== null;

  useEffect(() => {
    setEditing(false); setMessage(null); setTouchOffset(0); touchStart.current = null;
  }, [currentKey]);
  useEffect(() => { if (editing) correctionHeading.current?.focus(); }, [editing]);

  const remember = (transaction: Transaction) => {
    const key = transactionReviewKey(transaction);
    const baseline = incomingRecords.current.find(record => transactionReviewKey(record) === key);
    setSnapshots(previous => ({ ...previous, [key]: { transaction, baseline } }));
    onTransactionUpdate(transaction);
  };

  const readCurrent = async (transaction: Transaction): Promise<Transaction> => {
    const response = await makeAuthenticatedRequest(`/api/transactions/${encodeURIComponent(transaction.trans_id || transaction.id)}`, { cache: 'no-store' });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.transaction) throw new Error('Could not refresh the saved transaction. Try again.');
    return payload.transaction as Transaction;
  };

  // Only refresh saved work here. Viewing or swiping never starts a provider request.
  useEffect(() => {
    if (!current || (!analysisRunning && !analysisQueued)) return;
    let canceled = false;
    let pending = false;
    const owner = user.id;
    const timer = setInterval(async () => {
      if (pending || document.hidden) return;
      pending = true;
      try {
        const transaction = await readCurrent(current);
        if (!canceled && activeUser.current === owner) remember(transaction);
      } catch { /* Keep the last saved state; the user can refresh explicitly. */ }
      finally { pending = false; }
    }, 5000);
    return () => { canceled = true; clearInterval(timer); };
    // Stable identity/status starts a bounded poll for the card being viewed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentKey, analysisRunning, analysisQueued, user.id]);

  const openCorrection = () => {
    if (!current || operationLock.current || current.pending) return;
    setKind(suggestion?.transactionKind && suggestion.transactionKind !== 'unknown' ? suggestion.transactionKind : 'expense');
    setCategory(suggestion?.category ?? (suggestion?.transactionKind && ['personal', 'income', 'transfer'].includes(suggestion.transactionKind) ? suggestion.transactionKind : ''));
    setDeductible(null);
    setReason(''); setMessage(null); setEditing(true);
  };

  const saveReview = async (action: 'confirm' | 'correct') => {
    if (!current || operationLock.current || current.pending || (action === 'confirm' && !mayConfirm)) return;
    const accountId = current.account_id || current.accountId;
    if (!accountId) { setMessage('This transaction is missing its account. Open its details or refresh before reviewing.'); return; }
    if (action === 'correct' && !category) { setMessage('Choose a category before saving.'); return; }
    operationLock.current = true; setOperation('saving'); setMessage(null);
    const owner = user.id;
    const key = currentKey;
    try {
      const response = await makeAuthenticatedRequest(`/api/transactions/${encodeURIComponent(current.trans_id || current.id)}/review`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action === 'confirm'
          ? { action, accountId, suggestionId: suggestion!.id }
          : { action, accountId, category, transactionKind: kind, isDeductible: kind === 'expense' ? deductible : kind === 'refund' ? null : false, reason: reason.trim() || undefined }),
      });
      const result = await response.json().catch(() => null);
      if (!mounted.current || activeUser.current !== owner || activeKey.current !== key) return;
      if (!response.ok || !result?.success || !result.transaction) {
        if (response.status === 409) {
          try { remember(await readCurrent(current)); } catch { /* Keep the error actionable without hiding the card. */ }
          setMessage('This transaction or its AI suggestion changed. Review the latest details before confirming.');
        } else setMessage(response.status === 401 ? 'Your session expired. Sign in again to save your review.' : result?.error || 'Your review was not saved. Please try again.');
        return;
      }
      remember(result.transaction);
      setReviewed(previous => new Set([...previous, key]));
      setEditing(false);
      toast.success(result.transaction.tax_review_required ? 'Category saved · tax details still need review' : action === 'confirm' ? 'AI categorization confirmed' : 'Your correction was saved');
    } catch {
      if (mounted.current && activeUser.current === owner && activeKey.current === key) setMessage('Your review was not saved. Check your connection and try again.');
    } finally { operationLock.current = false; if (mounted.current) { setOperation(null); setTouchOffset(0); } }
  };

  const runAnalysis = async () => {
    if (!current || operationLock.current || current.pending || analysisRunning || availability.status !== 'configured' || providerFailed) return;
    operationLock.current = true; setOperation('analyzing'); setMessage(null);
    const owner = user.id;
    const key = currentKey;
    try {
      const response = await makeAuthenticatedRequest('/api/ai/analyze-transaction', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionId: current.trans_id || current.id,
          transaction: { merchant_name: current.merchant_name, amount: current.amount, category: current.category, date: current.date } }),
      });
      const result = await response.json().catch(() => null);
      if (!mounted.current || activeUser.current !== owner || activeKey.current !== key) return;
      if (!response.ok) {
        if (response.status === 503 || result?.code === 'AI_UNAVAILABLE') setProviderFailed(true);
        setMessage(response.status === 503 ? 'AI is temporarily unavailable. You can categorize this transaction yourself or retry when service is restored.' : result?.error || 'AI analysis could not finish. Your transaction has not changed.');
        return;
      }
      const transaction = await readCurrent(current);
      if (!mounted.current || activeUser.current !== owner || activeKey.current !== key) return;
      remember(transaction);
      if (!transaction.ai_suggestion) setMessage('Analysis finished, but the saved suggestion could not be loaded. Refresh before confirming.');
    } catch {
      if (mounted.current && activeUser.current === owner && activeKey.current === key) setMessage('Could not complete or refresh analysis. Your existing classification has not changed.');
    } finally { operationLock.current = false; if (mounted.current) setOperation(null); }
  };

  const swipe = (direction: 'left' | 'right') => {
    if (editing || operationLock.current) return;
    if (direction === 'left') openCorrection();
    else void saveReview('confirm');
  };
  const later = () => {
    if (!current || operationLock.current) return;
    setDeferred(previous => new Set([...previous, currentKey]));
  };

  if (!current) return (
    <div className="min-h-screen bg-background px-4 py-12 flex items-center justify-center">
      <div className="max-w-md w-full rounded-3xl border border-border bg-card p-8 text-center space-y-5">
        <CheckCircle className="h-12 w-12 mx-auto text-primary" />
        <h1 className="text-2xl font-semibold">{remaining.length ? 'Saved for later' : transactions.length ? 'Categories reviewed' : 'Your review queue starts here'}</h1>
        <p className="text-muted-foreground">{remaining.length
          ? `${remaining.length} transaction${remaining.length === 1 ? ' still needs' : 's still need'} review. Nothing was confirmed when you chose Later.`
          : transactions.length ? 'Your categorization decisions are saved. New transactions will appear here for review.'
          : 'Add a transaction or connect a bank to start building your tax records.'}</p>
        {taxQuestions.length > 0 && <p className="text-sm text-amber-700 dark:text-amber-400">{taxQuestions.length} categorized transaction{taxQuestions.length === 1 ? ' still needs' : 's still need'} tax details. Deductions remain unresolved.</p>}
        {taxQuestions.length > 0 && onTransactionClick && <Button className="w-full" onClick={() => onTransactionClick({ ...taxQuestions[0], _source: 'review-transactions' })}>Resolve missing tax details</Button>}
        {remaining.length > 0 && <Button className="w-full" onClick={() => setDeferred(new Set())}>Review remaining transactions</Button>}
        <Button variant="outline" className="w-full" onClick={onBack}>Back to dashboard</Button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-background px-4 pb-12">
      <div className="mx-auto max-w-2xl">
        <header className="sticky top-0 z-10 bg-background/95 backdrop-blur py-4 border-b border-border mb-5">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" aria-label="Back to dashboard" onClick={onBack}><ArrowLeft className="h-5 w-5" /></Button>
            <div className="flex-1"><h1 className="text-xl font-semibold">Review transactions</h1><p className="text-sm text-muted-foreground">{remaining.length} {remaining.length === 1 ? 'needs' : 'need'} review{reviewed.size > 0 ? ` · ${reviewed.size} confirmed this session` : ''}</p></div>
            <Sparkles className="h-5 w-5 text-primary" />
          </div>
          <p className="text-xs text-muted-foreground text-center mt-3">Swipe right to confirm AI’s suggestion · Swipe left to change it</p>
        </header>

        <article className="rounded-3xl border border-border bg-card shadow-sm overflow-hidden" aria-label="Transaction to review"
          style={{ transform: `translateX(${Math.max(-70, Math.min(70, touchOffset))}px)`, touchAction: 'pan-y' }}
          onTouchStart={event => {
            if (editing || operationLock.current || (event.target as HTMLElement).closest('button, a, input, textarea, select')) return;
            touchStart.current = { x: event.touches[0].clientX, y: event.touches[0].clientY }; setTouchOffset(0);
          }}
          onTouchMove={event => {
            if (!touchStart.current) return;
            const dx = event.touches[0].clientX - touchStart.current.x;
            const dy = event.touches[0].clientY - touchStart.current.y;
            if (Math.abs(dy) > 50) { touchStart.current = null; setTouchOffset(0); return; }
            setTouchOffset(dx);
          }}
          onTouchEnd={() => { if (touchStart.current && Math.abs(touchOffset) > 100) swipe(touchOffset > 0 ? 'right' : 'left'); touchStart.current = null; setTouchOffset(0); }}
          onTouchCancel={() => { touchStart.current = null; setTouchOffset(0); }}>
          <div className="p-5 sm:p-7 space-y-6">
            <div className="flex justify-between gap-4">
              <div className="min-w-0"><h2 className="text-xl font-semibold break-words">{current.merchant_name || 'Transaction'}</h2><p className="mt-1 text-sm text-muted-foreground">{current.date}{current.pending ? ' · Bank pending' : ''}</p></div>
              <div className="text-right shrink-0"><p className="text-xl font-semibold">{Number.isFinite(current.amount) ? `$${Math.abs(current.amount).toFixed(2)}` : 'Amount needs review'}</p><p className="text-xs text-muted-foreground">{current.amount < 0 ? 'Received' : 'Spent'}</p></div>
            </div>

            <section className="rounded-2xl border border-primary/20 bg-primary/5 p-5 space-y-3" aria-labelledby="suggestion-heading">
              <div className="flex items-center gap-2 text-primary text-sm font-medium"><Sparkles className="h-4 w-4" /><span>{presentation!.label}</span></div>
              <h3 id="suggestion-heading" className="text-2xl font-semibold">{presentation!.categoryLabel}</h3>
              {suggestion?.transactionKind && suggestion.transactionKind !== 'unknown' && <p className="font-medium text-sm">{kindLabels[suggestion.transactionKind]}{suggestion.isDeductible === true ? ' · Potential business deduction' : ''}</p>}
              <p className="text-sm leading-relaxed">{presentation!.reasoning}</p>
              {presentation!.taxYear && <p className="text-xs text-muted-foreground">Tax year {presentation!.taxYear} · U.S. federal self-employed guidance</p>}
              {suggestion?.isDeductible === true && typeof suggestion.deductiblePercent === 'number' && <p className="text-xs text-muted-foreground">Suggested deductible portion: {suggestion.deductiblePercent}%. Category rules and your documented business use still apply.</p>}
              {(!mayConfirm || presentation!.needsTaxFacts) && <p className="text-sm text-amber-700 dark:text-amber-400">{presentation!.confirmationHint}</p>}
            </section>

            {presentation!.questions.length > 0 && <section className="space-y-2"><h3 className="text-sm font-semibold">What AI needs from you</h3><ul className="list-disc pl-5 text-sm text-muted-foreground space-y-2">{presentation!.questions.map(question => <li key={question}>{question}</li>)}</ul><Button variant="outline" onClick={() => onTransactionClick?.({ ...current, _source: 'review-transactions' })}>Add missing details</Button></section>}
            {presentation!.documentation.length > 0 && <section className="space-y-2"><h3 className="text-sm font-semibold flex items-center gap-2"><FileText className="h-4 w-4" />Keep these records</h3><ul className="list-disc pl-5 text-sm text-muted-foreground space-y-1">{presentation!.documentation.map(item => <li key={item}>{item}</li>)}</ul></section>}
            {presentation!.sources.length > 0 && <section className="space-y-2"><h3 className="text-sm font-semibold">Tax guidance used</h3><ul className="space-y-2">{presentation!.sources.map(source => <li key={source.url}><a href={source.url} target="_blank" rel="noopener noreferrer" className="text-sm text-primary inline-flex items-center gap-1 underline underline-offset-4">{source.title}<ExternalLink className="h-3 w-3" /></a><p className="text-xs text-muted-foreground">{source.edition}{source.reviewed_at ? ` · Checked ${source.reviewed_at}` : ''}</p></li>)}</ul></section>}

            {message && <p role="alert" className="rounded-xl bg-amber-500/10 border border-amber-500/20 p-3 text-sm">{message}</p>}
            {current.pending !== true && !analysisRunning && !editing && <div className="flex flex-wrap gap-2 items-center">
              <Button variant="outline" disabled={busy || availability.status !== 'configured' || providerFailed} onClick={runAnalysis}>{operation === 'analyzing' ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}{operation === 'analyzing' ? 'Analyzing…' : availability.status === 'checking' ? 'Checking AI…' : availability.status !== 'configured' || providerFailed ? 'AI unavailable' : suggestion ? 'Reanalyze' : 'Run AI analysis'}</Button>
              {(availability.status === 'unavailable' || providerFailed) && <Button variant="ghost" disabled={busy} onClick={async () => { if (await availability.refresh()) setProviderFailed(false); }}>Check AI availability</Button>}
            </div>}
            {analysisQueued && <p role="status" className="text-sm text-muted-foreground">Queued for automatic analysis. You can run it now or wait for the result.</p>}
            {analysisRunning && <p role="status" className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />AI is analyzing this transaction. Results refresh here.</p>}
            {availability.status === 'unavailable' && <p className="text-xs text-muted-foreground">{availability.message} Manual categorization remains available.</p>}

            {editing && <section className="rounded-2xl border border-border p-4 space-y-4" aria-labelledby="correction-heading">
              <h3 id="correction-heading" ref={correctionHeading} tabIndex={-1} className="font-semibold">Correct the categorization</h3>
              <div><label htmlFor="review-kind" className="block text-sm font-medium mb-1">What is this transaction?</label><select id="review-kind" value={kind} onChange={event => { const next = event.target.value as Exclude<TransactionKind, 'unknown'>; setKind(next); setDeductible(null); if (next === 'personal' || next === 'income' || next === 'transfer') setCategory(next); else setCategory(''); }} className="w-full rounded-lg border border-border bg-background p-3" disabled={busy}>{Object.entries(kindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
              {(kind === 'expense' || kind === 'refund') && <div><label htmlFor="review-category" className="block text-sm font-medium mb-1">Category</label><select id="review-category" value={category} onChange={event => { setCategory(event.target.value); setDeductible(null); }} className="w-full rounded-lg border border-border bg-background p-3" disabled={busy}><option value="">Choose a category</option>{REVIEW_CATEGORIES.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>}
              {kind === 'expense' && <div><label htmlFor="review-deduction" className="block text-sm font-medium mb-1">Tax treatment</label><select id="review-deduction" value={deductible === null ? 'unresolved' : String(deductible)} onChange={event => setDeductible(event.target.value === 'unresolved' ? null : event.target.value === 'true')} disabled={busy} className="w-full rounded-lg border border-border bg-background p-3"><option value="unresolved">Save category; review tax treatment later</option><option value="true" disabled={['equipment', 'vehicle_expense', 'home_office', 'other'].includes(category)}>I confirmed this is a business deduction</option><option value="false">Not deductible</option></select><p className="text-xs text-muted-foreground mt-2">Only confirm a deduction when you have verified the business purpose and applicable rules. Meals and other limits still apply.</p></div>}
              {kind === 'refund' && <p className="text-sm text-muted-foreground">Record the original expense category. The refund still needs reconciliation against the original expense before it changes a tax deduction.</p>}
              <div><label htmlFor="review-reason" className="block text-sm font-medium mb-1">Your note <span className="font-normal text-muted-foreground">(optional)</span></label><textarea id="review-reason" value={reason} onChange={event => setReason(event.target.value)} maxLength={1000} className="w-full rounded-lg border border-border bg-background p-3 min-h-24" placeholder="For example: supplies used only for my client projects" disabled={busy} /></div>
              <div className="flex gap-3"><Button variant="outline" disabled={busy} onClick={() => setEditing(false)}>Cancel</Button><Button disabled={busy || !category} onClick={() => saveReview('correct')}>{operation === 'saving' ? 'Saving…' : 'Save correction'}</Button></div>
            </section>}

            <button className="flex w-full items-center justify-between gap-3 rounded-xl border border-border p-3 text-sm hover:bg-muted" onClick={() => onTransactionClick?.({ ...current, _source: 'review-transactions' })}><span>View details, business context and receipts</span><ChevronRight className="h-4 w-4 shrink-0" /></button>
          </div>
          {!editing && <div className="border-t border-border grid grid-cols-3 gap-2 p-4">
            <Button variant="outline" disabled={busy || current.pending === true} onClick={() => swipe('left')} className="h-auto py-3 flex-col gap-1"><Edit3 className="h-5 w-5" /><span>Change</span></Button>
            <Button variant="ghost" disabled={busy} onClick={later} className="h-auto py-3 flex-col gap-1"><SkipForward className="h-5 w-5" /><span>Later</span></Button>
            <Button disabled={busy || !mayConfirm} onClick={() => saveReview('confirm')} className="h-auto py-3 flex-col gap-1">{operation === 'saving' ? <Loader2 className="h-5 w-5 animate-spin" /> : <Check className="h-5 w-5" />}<span>{operation === 'saving' ? 'Saving…' : 'Confirm category'}</span></Button>
          </div>}
        </article>
        <p className="mt-4 text-center text-xs text-muted-foreground">AI proposes a category and explains the tax treatment. Your confirmation saves your decision; it does not file a tax return.</p>
      </div>
    </div>
  );
};
