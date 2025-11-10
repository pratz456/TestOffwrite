'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/lib/firebase/auth-context';
import { getAuth } from 'firebase/auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

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
    <div className="mx-auto max-w-lg p-3">
      <Card className="rounded-lg">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Classify this bank account</CardTitle>
          <p className="text-xs text-gray-600 mt-1">
            Choose how this account is primarily used. This helps us provide the most relevant tax deduction analysis.
          </p>
          {importedCount !== null && importedCount > 0 && (
            <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-md">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                <span className="text-sm font-medium text-green-800">
                  Successfully imported {importedCount} {importedCount === 1 ? 'transaction' : 'transactions'}
                </span>
              </div>
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <div className="flex items-start gap-2 p-2 border border-green-200 bg-green-50 rounded-md">
              <input
                type="radio"
                id="business"
                name="usage"
                value="business"
                checked={usage === 'business'}
                onChange={(e) => setUsage(e.target.value as 'business'|'personal'|'mixed')}
                className="mt-0.5"
              />
              <div>
                <label htmlFor="business" className="text-sm font-medium text-green-800">Business</label>
                <p className="text-xs text-green-700 mt-0.5">Best for tax deduction analysis. All transactions will be analyzed for business expense potential.</p>
              </div>
            </div>

            <div className="flex items-start gap-2 p-2 border border-orange-200 bg-orange-50 rounded-md">
              <input
                type="radio"
                id="personal"
                name="usage"
                value="personal"
                checked={usage === 'personal'}
                onChange={(e) => setUsage(e.target.value as 'business'|'personal'|'mixed')}
                className="mt-0.5"
              />
              <div>
                <label htmlFor="personal" className="text-sm font-medium text-orange-800">Personal</label>
                <p className="text-xs text-orange-700 mt-0.5">⚠️ Personal accounts are not useful for tax calculations. All transactions will be marked as personal expenses.</p>
              </div>
            </div>

            <div className="flex items-start gap-2 p-2 border border-blue-200 bg-blue-50 rounded-md">
              <input
                type="radio"
                id="mixed"
                name="usage"
                value="mixed"
                checked={usage === 'mixed'}
                onChange={(e) => setUsage(e.target.value as 'business'|'personal'|'mixed')}
                className="mt-0.5"
              />
              <div>
                <label htmlFor="mixed" className="text-sm font-medium text-blue-800">Both (Mixed use)</label>
                <p className="text-xs text-blue-700 mt-0.5">Good for accounts used for both business and personal expenses. You can specify the business percentage.</p>
              </div>
            </div>
          </div>

          {usage === 'mixed' && (
            <div className="space-y-1">
              <Label htmlFor="percent" className="text-sm">Approx. % used for business</Label>
              <div className="flex items-center gap-2">
                <input
                  id="percent"
                  type="range"
                  min={0}
                  max={100}
                  value={percent}
                  onChange={(e)=>setPercent(parseInt(e.target.value))}
                  className="w-full h-6"
                />
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={percent}
                  onChange={(e)=>setPercent(Math.max(0, Math.min(100, parseInt(e.target.value||'0'))))}
                  className="w-16 h-6 text-center text-sm"
                />
                <span className="text-sm">%</span>
              </div>
            </div>
          )}

          <div className="flex gap-2 items-center">
            <Button onClick={save} disabled={saving} className="h-8 px-3 text-sm">
              {saving ? 'Saving…' : (
                usage === 'personal' ? 'Mark as Personal & Continue' :
                usage === 'business' ? 'Save & Start Analysis' :
                'Save & Start Analysis'
              )}
            </Button>

            <Button variant="secondary" onClick={() => router.push('/protected/plaid-link')} className="h-8 px-3 text-sm">
              Connect a different bank
            </Button>

            <Button variant="ghost" onClick={() => router.push('/protected/plaid')} className="h-8 px-3 text-sm">
              Skip for now
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
