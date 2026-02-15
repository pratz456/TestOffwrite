'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/lib/firebase/auth-context';
import { getAuth } from 'firebase/auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Slider } from '@/ui/slider';

async function startAnalysis(accountId?: string) {
  const auth = getAuth();
  const idToken = await auth.currentUser?.getIdToken?.();
  if (!idToken) throw new Error('no-id-token');

  const res = await fetch('/api/plaid/auto-analyze', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${idToken}`,
    },
    body: JSON.stringify({ accountId }),
  });
  if (!res.ok) throw new Error('failed-to-start-analysis');
}

// (optional) brief poll to show progress before moving
async function waitForAnalysisDone(accountId: string, timeoutMs = 20000, stepMs = 1500) {
  const auth = getAuth();
  const idToken = await auth.currentUser?.getIdToken?.();
  if (!idToken) return false;

  const jobId = `${auth.currentUser?.uid}_${accountId}`;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const s = await fetch(`/api/analysis-job?jobId=${jobId}`, {
        headers: { 'Authorization': `Bearer ${idToken}` }
      }).then(r => r.json());

      if (s?.data?.status === 'completed' || s?.data?.status === 'failed') {
        return s.data.status === 'completed';
      }
    } catch {}
    await new Promise(r => setTimeout(r, stepMs));
  }
  return false;
}

export default function AccountUsagePage() {
  const router = useRouter();
  const { accountId } = useParams<{accountId: string}>();
  const { user } = useAuth();

  const [usage, setUsage] = useState<'business'|'personal'|'mixed'>('business');
  const [percent, setPercent] = useState<number>(50);
  const [saving, setSaving] = useState(false);
  const [importedCount, setImportedCount] = useState<number | null>(null);

  useEffect(() => {
    if (!user) router.push('/auth/login');

    // Get imported transaction count from URL params
    const urlParams = new URLSearchParams(window.location.search);
    const importedParam = urlParams.get('imported');
    if (importedParam) {
      const count = parseInt(importedParam, 10);
      if (!isNaN(count)) {
        setImportedCount(count);
        console.log(`📊 [Account Usage] Found ${count} imported transactions`);
      }
    }
  }, [user, router]);

  async function save() {
    setSaving(true);
    try {
      const auth = getAuth();
      const idToken = await auth.currentUser?.getIdToken?.();
      if (!idToken) throw new Error('no-id-token');

      const body: any = { usageType: usage };
      if (usage === 'mixed') body.businessUsePercent = percent;

      // 1) save usage (AUTH HEADER ADDED)
      const r1 = await fetch(`/api/accounts/${accountId}/usage`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify(body),
      });

      if (!r1.ok) {
        const t = await r1.text().catch(()=>'');
        console.error('save-usage server error:', r1.status, t);
        throw new Error('save-usage-failed');
      }

      // 2) branch by usage
      if (usage === 'personal') {
        // Mark all transactions as personal (AUTH HEADER ADDED)
        await fetch(`/api/accounts/${accountId}/mark-personal`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${idToken}` },
        }).catch(()=>{});

        // Show personal account message and redirect to dashboard
        alert('Personal accounts are not useful for tax calculations. All transactions have been marked as personal expenses. Consider connecting a business account for tax deduction analysis.');
        router.push('/protected');
        return;
      }

      // business / mixed → start AI (AUTH HEADER ADDED)
      const r2 = await fetch('/api/plaid/auto-analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify({ accountId }),
      });

      if (!r2.ok) {
        const errorData = await r2.json().catch(() => ({}));
        const errorText = await r2.text().catch(() => '');
        console.error('auto-analyze server error:', r2.status, errorText);

        // Check if it's a "no transactions" error
        if (r2.status === 400 && (errorData.error?.includes('No transactions') || errorData.details?.includes('no transactions'))) {
          // Show user-friendly message and suggest syncing transactions
          const message = errorData.suggestion || errorData.details || 'No transactions found. Please sync transactions first.';
          alert(`⚠️ ${message}\n\nYou can sync transactions from the Banks settings page.`);
          // Redirect to banks settings or transactions page
          router.push('/protected?screen=settings');
          return;
        }

        // For other errors, still continue to transactions; user can retry from there
        console.warn('Auto-analyze failed but continuing to transactions page');
      } else {
        // Check response data
        const responseData = await r2.json().catch(() => ({}));

        // If transactions were imported and analysis started
        if (responseData.imported && responseData.imported > 0) {
          console.log(`✅ Transactions imported (${responseData.imported}), analysis started`);
          const message = responseData.message || `Successfully imported ${responseData.imported} transactions. Analysis has started.`;

          // Show success message
          if (responseData.pendingTransactions > 0) {
            alert(`✅ ${message}\n\nRedirecting to view analysis progress...`);
            // Redirect to transactions page to see analysis progress
            router.push(`/protected?screen=review-transactions&accountId=${accountId}`);
          } else {
            alert(`✅ ${message}`);
            // If all transactions are already analyzed, just go to transactions page
            router.push(`/protected?screen=review-transactions&accountId=${accountId}`);
          }
          return;
        }

        // Normal response - analysis started or already running
        console.log('✅ Auto-analyze started successfully');
      }

      // Redirect to PlaidLinkScreen to show analyzing progress
      router.push(`/protected?screen=plaid-link&accountId=${accountId}&analyzing=true`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-start justify-center p-5 sm:p-6 pt-8 pb-12">
      <Card className="w-full max-w-[28rem] rounded-2xl border-0 shadow-lg bg-card/95 backdrop-blur-sm">
        <CardHeader className="px-6 sm:px-8 pt-6 sm:pt-8 pb-4 space-y-3">
          <CardTitle className="text-[22px] sm:text-2xl font-bold tracking-tight text-foreground">
            Classify this bank account
          </CardTitle>
          <p className="text-sm text-muted-foreground/90 max-w-md">
            Choose how this account is primarily used. This helps us provide the most relevant tax deduction analysis.
          </p>
          {importedCount !== null && importedCount > 0 && (
            <div className="mt-1 inline-flex items-center gap-2 rounded-full px-3 py-1.5 bg-[var(--success-weak)] border-0">
              <div className="w-1.5 h-1.5 rounded-full bg-success shrink-0" />
              <span className="text-xs font-medium text-foreground">
                Successfully imported {importedCount} {importedCount === 1 ? 'transaction' : 'transactions'}
              </span>
            </div>
          )}
        </CardHeader>
        <CardContent className="px-6 sm:px-8 pb-6 sm:pb-8 space-y-6">
          <div className="space-y-3" role="radiogroup" aria-label="Account type">
            <label
              className={`flex items-start gap-4 p-4 rounded-xl cursor-pointer transition-all duration-200 ease-out ${
                usage === 'business'
                  ? 'bg-muted/50 dark:bg-muted/40 border border-primary/60 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.03)] dark:shadow-[inset_0_1px_0_0_rgba(0,0,0,0.2)] scale-[1.02] -translate-y-0.5 shadow-md ring-1 ring-primary/20'
                  : 'bg-muted/20 dark:bg-muted/30 border border-transparent hover:bg-muted/40 hover:shadow-sm hover:scale-[1.01]'
              }`}
            >
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-muted-foreground/40 transition-all duration-200">
                {usage === 'business' && <span className="h-2.5 w-2.5 rounded-full bg-primary" />}
              </span>
              <input
                type="radio"
                name="usage"
                value="business"
                checked={usage === 'business'}
                onChange={(e) => setUsage(e.target.value as 'business'|'personal'|'mixed')}
                className="sr-only"
                aria-label="Business"
              />
              <div className="flex-1 min-w-0 space-y-1">
                <span className="text-sm font-semibold text-foreground">Business</span>
                <p className="text-xs text-muted-foreground leading-relaxed">Best for tax deduction analysis. All transactions will be analyzed for business expense potential.</p>
              </div>
            </label>

            <label
              className={`flex items-start gap-4 p-4 rounded-xl cursor-pointer transition-all duration-200 ease-out ${
                usage === 'personal'
                  ? 'bg-destructive/5 dark:bg-destructive/10 border border-destructive/40 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.03)] scale-[1.02] -translate-y-0.5 shadow-md ring-1 ring-destructive/20'
                  : 'bg-muted/20 dark:bg-muted/30 border border-transparent hover:bg-muted/40 hover:shadow-sm hover:scale-[1.01]'
              }`}
            >
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-muted-foreground/40 transition-all duration-200">
                {usage === 'personal' && <span className="h-2.5 w-2.5 rounded-full bg-destructive" />}
              </span>
              <input
                type="radio"
                name="usage"
                value="personal"
                checked={usage === 'personal'}
                onChange={(e) => setUsage(e.target.value as 'business'|'personal'|'mixed')}
                className="sr-only"
                aria-label="Personal"
              />
              <div className="flex-1 min-w-0 space-y-1">
                <span className="text-sm font-semibold text-foreground">Personal</span>
                <p className="text-xs text-muted-foreground leading-relaxed">Personal accounts are not used for tax calculations. All transactions will be marked as personal expenses.</p>
              </div>
            </label>

            <label
              className={`flex items-start gap-4 p-4 rounded-xl cursor-pointer transition-all duration-200 ease-out ${
                usage === 'mixed'
                  ? 'bg-muted/50 dark:bg-muted/40 border border-primary/60 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.03)] dark:shadow-[inset_0_1px_0_0_rgba(0,0,0,0.2)] scale-[1.02] -translate-y-0.5 shadow-md ring-1 ring-primary/20'
                  : 'bg-muted/20 dark:bg-muted/30 border border-transparent hover:bg-muted/40 hover:shadow-sm hover:scale-[1.01]'
              }`}
            >
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-muted-foreground/40 transition-all duration-200">
                {usage === 'mixed' && <span className="h-2.5 w-2.5 rounded-full bg-primary" />}
              </span>
              <input
                type="radio"
                name="usage"
                value="mixed"
                checked={usage === 'mixed'}
                onChange={(e) => setUsage(e.target.value as 'business'|'personal'|'mixed')}
                className="sr-only"
                aria-label="Both (Mixed use)"
              />
              <div className="flex-1 min-w-0 space-y-1">
                <span className="text-sm font-semibold text-foreground">Both (Mixed use)</span>
                <p className="text-xs text-muted-foreground leading-relaxed">For accounts used for both business and personal. You can set the business percentage below.</p>
              </div>
            </label>
          </div>

          {usage === 'mixed' && (
            <div
              className="rounded-xl bg-muted/15 dark:bg-muted/25 border-t border-border pt-6 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200"
              role="group"
              aria-labelledby="percent-label"
            >
              <div className="space-y-3 px-0">
                <Label id="percent-label" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Business Usage
                </Label>
                <p className="text-4xl sm:text-5xl font-bold tabular-nums text-foreground tracking-tight" aria-live="polite" aria-atomic="true">
                  {percent}%
                </p>
              </div>
              <div className="w-full px-0.5 py-2 mt-4">
                <Slider
                  id="percent"
                  min={0}
                  max={100}
                  step={1}
                  value={[percent]}
                  onValueChange={(v) => setPercent(v[0] ?? 50)}
                  aria-label="Business use percentage"
                  aria-valuetext={`${percent} percent business`}
                  aria-describedby="percent-description"
                  className="w-full touch-manipulation min-h-[44px] py-3"
                  trackClassName="data-[orientation=horizontal]:h-2 bg-muted/80 dark:bg-muted rounded-full"
                  rangeClassName="data-[orientation=horizontal]:h-2 rounded-full bg-gradient-to-r from-primary to-primary/90"
                  thumbClassName="size-5 rounded-full bg-background border-2 border-primary shadow-md hover:shadow-lg hover:shadow-primary/20 hover:scale-105 focus-visible:ring-4 focus-visible:ring-primary/30 transition-all duration-150"
                />
              </div>
              <div className="flex justify-between px-0.5 -mt-1 pointer-events-none" aria-hidden="true">
                {[0, 25, 50, 75, 100].map((tick) => (
                  <span key={tick} className="w-0.5 h-2 rounded-full bg-muted-foreground/50" />
                ))}
              </div>
              <p className="text-sm text-muted-foreground mt-4 min-h-[2.5rem]" id="percent-description">
                {percent === 0 && 'Fully Personal Account'}
                {percent === 100 && 'Fully Business Account'}
                {percent > 0 && percent < 100 && 'Mixed usage – Expenses will be proportionally allocated.'}
              </p>
            </div>
          )}

          <div className="flex flex-col gap-4 pt-2">
            <Button
              onClick={save}
              disabled={saving}
              className="w-full h-12 rounded-xl font-semibold bg-gradient-to-r from-primary to-primary/90 hover:from-primary/95 hover:to-primary/85 shadow-md hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              {saving ? 'Saving…' : usage === 'personal' ? 'Mark as Personal & Continue' : 'Save & Start Analysis'}
            </Button>
            <div className="flex items-center justify-center gap-3 text-sm">
              <button
                type="button"
                onClick={() => router.push('/protected/plaid-link')}
                className="text-muted-foreground hover:text-foreground font-medium transition-colors hover:underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 rounded"
              >
                Connect a different bank
              </button>
              <span className="text-muted-foreground/60" aria-hidden="true">·</span>
              <button
                type="button"
                onClick={() => router.push('/protected/plaid')}
                className="text-muted-foreground hover:text-foreground transition-colors hover:underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 rounded"
              >
                Skip for now
              </button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
