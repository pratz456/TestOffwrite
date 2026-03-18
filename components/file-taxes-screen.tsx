"use client";

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  ArrowLeft,
  FileText,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Lock,
  Sparkles,
  Send,
  ShieldCheck,
  ExternalLink,
  RefreshCw,
} from 'lucide-react';
import { useAuth } from '@/lib/firebase/auth-context';
import { useSubscription } from '@/lib/hooks/use-subscription';
import { useTransactions } from '@/lib/react-query/hooks';
import { makeAuthenticatedRequest } from '@/lib/firebase/api-client';
import { useRouter } from 'next/navigation';
import Script from 'next/script';
import {
  aggregateScheduleC,
  type AggregateScheduleCResult,
} from '@/lib/schedule-c/aggregate';

type FilingStep = 'review' | 'confirm' | 'filing' | 'complete' | 'error';

interface FilingStatus {
  filingStatus: string | null;
  filingYear?: number;
  lastSyncedAt?: string;
}

export function FileTaxesScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const {
    hasAccess,
    isLoading: subscriptionLoading,
  } = useSubscription();

  const { data: response, isLoading: txLoading } = useTransactions(
    user?.id || '',
  );
  const transactions = response?.transactions || response?.data || [];

  const [selectedYear, setSelectedYear] = useState(
    String(new Date().getFullYear()),
  );
  const [step, setStep] = useState<FilingStep>('review');
  const [confirmed, setConfirmed] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [userUrl, setUserUrl] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [filingStatus, setFilingStatus] = useState<FilingStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);

  const aggregation: AggregateScheduleCResult | null = useMemo(() => {
    if (!transactions || transactions.length === 0) return null;
    return aggregateScheduleC(transactions, selectedYear);
  }, [transactions, selectedYear]);

  const fetchFilingStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      const res = await makeAuthenticatedRequest(
        '/api/tax/column-tax/status',
      );
      if (res.ok) {
        const data = await res.json();
        setFilingStatus(data);
      }
    } catch {
      // silent
    } finally {
      setStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user?.id) {
      fetchFilingStatus();
    }
  }, [user?.id, fetchFilingStatus]);

  const handleStartFiling = async () => {
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const res = await makeAuthenticatedRequest(
        '/api/tax/column-tax/start-filing',
        {
          method: 'POST',
          body: JSON.stringify({ year: parseInt(selectedYear, 10) }),
        },
      );

      const data = await res.json();

      if (!res.ok) {
        if (data.requiresSubscription) {
          router.push('/protected/subscriptions');
          return;
        }
        throw new Error(data.error || 'Failed to start filing');
      }

      setUserUrl(data.userUrl);
      setStep('filing');
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Something went wrong',
      );
      setStep('error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleFilingComplete = async () => {
    setStep('complete');
    await fetchFilingStatus();
  };

  useEffect(() => {
    if (step !== 'filing' || !userUrl) return;

    if (typeof window !== 'undefined' && (window as any).ColumnTax) {
      (window as any).ColumnTax.openModule({
        userUrl,
        onClose: () => setStep('review'),
        onUserEvent: (event: { name: string; metadata?: unknown }) => {
          if (event.name === 'filing_complete' || event.name === 'tax_return_submitted') {
            handleFilingComplete();
          }
        },
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, userUrl]);

  const formatCurrency = (amount: number): string =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);

  const isLoading = txLoading || subscriptionLoading;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background min-w-0 overflow-x-hidden">
      {/* Header */}
      <div className="bg-card border-b border-border sticky top-0 z-50 shadow-sm min-w-0">
        <div className="flex items-center justify-between p-4 sm:p-6 min-w-0">
          <button
            onClick={() => router.push('/protected/reports')}
            className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 rounded min-h-[44px] min-w-[44px] justify-center"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="text-center">
            <h1 className="text-xl font-semibold text-foreground">
              File Your Taxes
            </h1>
            <p className="text-sm text-muted-foreground">
              Powered by Column Tax
            </p>
          </div>
          <div className="w-12" />
        </div>
      </div>

      <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-6 min-w-0">
        {/* Existing Filing Status Banner */}
        {filingStatus?.filingStatus && filingStatus.filingStatus !== 'draft' && (
          <Card className="p-4 sm:p-6 bg-card border border-border shadow-sm">
            <div className="flex items-center gap-3">
              {filingStatus.filingStatus === 'submitted' && (
                <Send className="w-5 h-5 text-blue-500" />
              )}
              {filingStatus.filingStatus === 'accepted' && (
                <CheckCircle2 className="w-5 h-5 text-emerald-500" />
              )}
              {filingStatus.filingStatus === 'rejected' && (
                <AlertCircle className="w-5 h-5 text-red-500" />
              )}
              <div className="flex-1">
                <p className="font-medium text-foreground">
                  {filingStatus.filingYear} Tax Return:{' '}
                  <Badge
                    variant={
                      filingStatus.filingStatus === 'accepted'
                        ? 'default'
                        : filingStatus.filingStatus === 'rejected'
                          ? 'destructive'
                          : 'secondary'
                    }
                    className="ml-1"
                  >
                    {filingStatus.filingStatus.charAt(0).toUpperCase() +
                      filingStatus.filingStatus.slice(1)}
                  </Badge>
                </p>
                {filingStatus.lastSyncedAt && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Last updated:{' '}
                    {new Date(filingStatus.lastSyncedAt).toLocaleString()}
                  </p>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={fetchFilingStatus}
                disabled={statusLoading}
              >
                <RefreshCw
                  className={`w-4 h-4 ${statusLoading ? 'animate-spin' : ''}`}
                />
              </Button>
            </div>
          </Card>
        )}

        {/* Subscription Gate */}
        {!subscriptionLoading && !hasAccess && (
          <Card className="p-6 bg-gradient-to-r from-purple-50 to-blue-50 dark:from-purple-900/30 dark:to-blue-900/30 border border-purple-200 dark:border-purple-700 shadow-sm">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-purple-100 dark:bg-purple-800/50 rounded-xl">
                <Sparkles className="w-6 h-6 text-purple-600 dark:text-purple-400" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-foreground mb-1">
                  Unlock Tax Filing
                </h3>
                <p className="text-muted-foreground mb-4">
                  Subscribe to file your taxes directly from WriteOff. Your
                  Schedule C expenses will be pre-filled automatically.
                </p>
                <div className="flex flex-wrap gap-3">
                  <Button
                    onClick={() => router.push('/protected/subscriptions')}
                    className="bg-gradient-to-r from-purple-500 to-purple-600 dark:from-purple-500 dark:to-purple-600 hover:from-purple-600 hover:to-purple-700 text-white font-medium shadow-md shadow-purple-500/20 dark:shadow-purple-500/30 transition-all duration-200"
                  >
                    <Sparkles className="w-4 h-4 mr-2" />
                    Subscribe Now
                  </Button>
                </div>
              </div>
            </div>
          </Card>
        )}

        {/* ── Step: Review ─────────────────────────────────────────── */}
        {step === 'review' && hasAccess && (
          <>
            {/* Year Selector */}
            <Card className="p-4 sm:p-6 bg-card border border-border shadow-sm">
              <div className="min-w-0 w-full">
                <label className="block text-sm font-medium text-foreground mb-2">
                  Tax Year
                </label>
                <select
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(e.target.value)}
                  className="w-full max-w-xs min-h-[44px] p-3 border border-input rounded-lg bg-background text-foreground focus:ring-2 focus:ring-primary focus:border-primary focus:outline-none"
                >
                  <option value="2025">2025</option>
                  <option value="2024">2024</option>
                  <option value="2023">2023</option>
                </select>
              </div>
            </Card>

            {/* Schedule C Preview */}
            {aggregation && aggregation.lineItemsArray.length > 0 ? (
              <Card className="p-4 sm:p-6 bg-card border border-border shadow-sm overflow-hidden">
                <h3 className="text-lg font-semibold text-foreground mb-2">
                  Schedule C Summary &mdash; Tax Year {selectedYear}
                </h3>
                <p className="text-sm text-muted-foreground mb-4">
                  This data will be sent to Column Tax to pre-fill your return.
                </p>

                <div className="overflow-x-auto max-w-full rounded-lg border border-border">
                  <table className="w-full min-w-[480px] text-sm">
                    <thead className="bg-muted text-muted-foreground text-xs uppercase">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">
                          Line
                        </th>
                        <th className="px-3 py-2 text-left font-medium">
                          Description
                        </th>
                        <th className="px-3 py-2 text-right font-medium">
                          Transactions
                        </th>
                        <th className="px-3 py-2 text-right font-medium">
                          Deductible
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border bg-card/60">
                      {aggregation.lineItemsArray.map((item) => (
                        <tr
                          key={item.lineCode}
                          className="hover:bg-muted/50 transition-colors"
                        >
                          <td className="px-3 py-2 font-mono text-xs text-foreground tabular-nums">
                            {item.lineCode}
                          </td>
                          <td className="px-3 py-2 text-foreground">
                            {item.lineCode === '24b'
                              ? 'Meals (50%)'
                              : item.lineName}
                          </td>
                          <td className="px-3 py-2 text-right text-muted-foreground tabular-nums">
                            {item.transactionCount}
                          </td>
                          <td className="px-3 py-2 text-right font-medium text-foreground tabular-nums">
                            {formatCurrency(item.deductible)}
                          </td>
                        </tr>
                      ))}
                      <tr className="bg-muted font-semibold">
                        <td className="px-3 py-2 font-mono text-xs tabular-nums">
                          28
                        </td>
                        <td className="px-3 py-2">Total Expenses</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {aggregation.counts.deductible}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {formatCurrency(aggregation.totalDeductible)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <p className="mt-3 text-xs text-muted-foreground">
                  This is a preview based on your classified transactions.
                  Verify all amounts before filing.
                </p>

                <div className="mt-6">
                  <Button
                    onClick={() => setStep('confirm')}
                    className="w-full sm:w-auto min-h-[44px] h-12 font-medium rounded-lg flex items-center justify-center gap-2"
                  >
                    <FileText className="w-5 h-5" />
                    Continue to File
                  </Button>
                </div>
              </Card>
            ) : (
              <Card className="p-8 bg-card border border-border shadow-sm">
                <div className="text-center">
                  <FileText className="w-12 h-12 mx-auto mb-3 text-muted-foreground/70" />
                  <p className="text-foreground font-medium">
                    No deductible expenses found for {selectedYear}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Make sure your transactions are categorized and classified as
                    business expenses first.
                  </p>
                </div>
              </Card>
            )}

            {/* How It Works */}
            <Card className="p-4 sm:p-6 bg-card border border-border shadow-sm">
              <h4 className="text-lg font-semibold text-foreground mb-3">
                How It Works
              </h4>
              <div className="space-y-3 text-sm text-muted-foreground">
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
                    1
                  </div>
                  <p>
                    <span className="text-foreground font-medium">Review</span>{' '}
                    &mdash; Check your expense summary above. This is the data
                    that will pre-fill your Schedule C.
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
                    2
                  </div>
                  <p>
                    <span className="text-foreground font-medium">Confirm</span>{' '}
                    &mdash; Verify the data is accurate and confirm you want to
                    proceed.
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
                    3
                  </div>
                  <p>
                    <span className="text-foreground font-medium">File</span>{' '}
                    &mdash; Column Tax pre-fills your return. Review, sign, and
                    submit directly to the IRS.
                  </p>
                </div>
              </div>
            </Card>
          </>
        )}

        {/* ── Step: Confirm ────────────────────────────────────────── */}
        {step === 'confirm' && (
          <Card className="p-4 sm:p-6 bg-card border border-border shadow-sm">
            <div className="flex items-center gap-3 mb-4">
              <ShieldCheck className="w-6 h-6 text-primary" />
              <h3 className="text-lg font-semibold text-foreground">
                Confirm Your Data
              </h3>
            </div>

            <div className="bg-muted/50 rounded-lg p-4 mb-6 border border-border">
              <p className="text-sm text-foreground mb-2">
                You are about to send the following to Column Tax for tax year{' '}
                <span className="font-semibold">{selectedYear}</span>:
              </p>
              <ul className="text-sm text-muted-foreground space-y-1 ml-4 list-disc">
                <li>
                  {aggregation?.lineItemsArray.length || 0} expense categories
                  totaling{' '}
                  <span className="font-medium text-foreground">
                    {formatCurrency(aggregation?.totalDeductible || 0)}
                  </span>
                </li>
                <li>
                  {aggregation?.counts.deductible || 0} classified transactions
                </li>
              </ul>
            </div>

            <label className="flex items-start gap-3 cursor-pointer select-none mb-6">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                className="mt-1 w-4 h-4 rounded border-input text-primary focus:ring-primary"
              />
              <span className="text-sm text-foreground">
                I confirm that the expenses shown above are accurate to the best
                of my knowledge. I understand that I am responsible for the
                information filed on my tax return.
              </span>
            </label>

            <div className="flex flex-wrap gap-3">
              <Button
                onClick={handleStartFiling}
                disabled={!confirmed || isSubmitting}
                className="min-h-[44px] h-12 font-medium rounded-lg flex items-center gap-2"
              >
                {isSubmitting ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <Send className="w-5 h-5" />
                )}
                {isSubmitting ? 'Starting...' : 'Start Filing'}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setStep('review');
                  setConfirmed(false);
                }}
                disabled={isSubmitting}
                className="min-h-[44px] h-12"
              >
                Back to Review
              </Button>
            </div>
          </Card>
        )}

        {/* ── Step: Filing (Column Tax Module) ──────────────────────── */}
        {step === 'filing' && (
          <Card className="p-6 sm:p-8 bg-card border border-border shadow-sm">
            <div className="text-center space-y-4">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mx-auto">
                <ExternalLink className="w-8 h-8 text-primary" />
              </div>
              <h3 className="text-xl font-semibold text-foreground">
                Complete Your Return
              </h3>
              <p className="text-muted-foreground max-w-md mx-auto">
                Your Schedule C data has been sent to Column Tax. The filing
                module should have opened — review your pre-filled return and
                follow the steps to submit.
              </p>
              <div className="flex flex-wrap justify-center gap-3 pt-2">
                {userUrl && (
                  <Button
                    onClick={() => {
                      if ((window as any).ColumnTax) {
                        (window as any).ColumnTax.openModule({
                          userUrl,
                          onClose: () => setStep('review'),
                          onUserEvent: (event: { name: string; metadata?: unknown }) => {
                            if (event.name === 'filing_complete' || event.name === 'tax_return_submitted') {
                              handleFilingComplete();
                            }
                          },
                        });
                      }
                    }}
                    className="min-h-[44px]"
                  >
                    <ExternalLink className="w-4 h-4 mr-2" />
                    Reopen Filing Module
                  </Button>
                )}
                <Button
                  variant="outline"
                  onClick={() => setStep('review')}
                  className="min-h-[44px]"
                >
                  Back to Review
                </Button>
              </div>
            </div>
          </Card>
        )}

        {/* ── Step: Complete ────────────────────────────────────────── */}
        {step === 'complete' && (
          <Card className="p-8 bg-card border border-border shadow-sm">
            <div className="text-center">
              <CheckCircle2 className="w-16 h-16 text-emerald-500 mx-auto mb-4" />
              <h3 className="text-2xl font-bold text-foreground mb-2">
                Filing Submitted!
              </h3>
              <p className="text-muted-foreground mb-6 max-w-md mx-auto">
                Your {selectedYear} tax return has been submitted through Column
                Tax. You'll receive confirmation once the IRS accepts it.
              </p>
              <div className="flex flex-wrap justify-center gap-3">
                <Button
                  onClick={fetchFilingStatus}
                  variant="outline"
                  className="min-h-[44px]"
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Check Status
                </Button>
                <Button
                  onClick={() => router.push('/protected/reports')}
                  className="min-h-[44px]"
                >
                  Back to Reports
                </Button>
              </div>
            </div>
          </Card>
        )}

        {/* ── Step: Error ──────────────────────────────────────────── */}
        {step === 'error' && (
          <Card className="p-6 bg-card border border-destructive/30 shadow-sm">
            <div className="flex items-start gap-4">
              <AlertCircle className="w-6 h-6 text-destructive shrink-0 mt-0.5" />
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-foreground mb-1">
                  Something Went Wrong
                </h3>
                <p className="text-sm text-muted-foreground mb-4">
                  {errorMessage ||
                    'An unexpected error occurred while starting the filing process.'}
                </p>
                <div className="flex flex-wrap gap-3">
                  <Button
                    onClick={() => {
                      setStep('review');
                      setErrorMessage(null);
                      setConfirmed(false);
                    }}
                    className="min-h-[44px]"
                  >
                    Try Again
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => router.push('/protected/help')}
                    className="min-h-[44px]"
                  >
                    Get Help
                  </Button>
                </div>
              </div>
            </div>
          </Card>
        )}

        {/* Column Tax branding footer */}
        {hasAccess && (
          <div className="text-center py-4">
            <p className="text-xs text-muted-foreground">
              Tax filing is powered by Column Tax. Column Tax provides an
              accuracy guarantee and audit assistance.{' '}
              <a
                href="https://www.columntax.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                Learn more
              </a>
            </p>
          </div>
        )}
      </div>

      <Script
        src="https://prod.columntax.com/tax-module/column-tax.js"
        strategy="lazyOnload"
      />
    </div>
  );
}
