"use client";

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowRight, Download, FolderCheck, Lock, RefreshCw } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { makeAuthenticatedRequest } from '@/lib/firebase/api-client';
import { useSubscription } from '@/lib/hooks/use-subscription';
import { protectedScreenUrl } from '@/lib/navigation/protected-screens';
import type { AuditSupportPacket } from '@/lib/reports/audit-support-packet';

export type AuditSupportSummary = Pick<AuditSupportPacket, 'summary'> & { deductions: Array<Pick<AuditSupportPacket['deductions'][number], 'transactionId' | 'date' | 'merchant' | 'amount' | 'substantiation'>> };
type PacketFormat = 'json' | 'csv' | 'pdf';
const money = (value: number) => `${value < 0 ? '-' : ''}$${Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const MAX_LISTED = 5;

interface SummaryProps {
  year: number;
  packet: AuditSupportSummary | null;
  loading: boolean;
  error: { message: string; code?: string } | null;
  canDownloadPdf: boolean;
  downloading: PacketFormat | null;
  onDownload: (format: PacketFormat) => void;
  onOpenTransaction: (transactionId: string) => void;
  onRetry: () => void;
}

/** Presentational card: counts, the items that still need records, and the three export formats. */
export function AuditSupportRecordsSummary({ year, packet, loading, error, canDownloadPdf, downloading, onDownload, onOpenTransaction, onRetry }: SummaryProps) {
  const needsRecords = packet?.deductions.filter(record => record.substantiation.status === 'needs_records') ?? [];
  const summary = packet?.summary;
  return (
    <Card className="p-4 sm:p-5 bg-card border border-border border-l-[3px] border-l-amber-500/70 rounded-xl overflow-hidden mb-4 sm:mb-5" data-testid="audit-support-records">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0">
              <FolderCheck className="w-4 h-4 text-amber-600 dark:text-amber-400" />
            </div>
            <h2 className="text-base sm:text-lg font-semibold text-foreground">Audit support records <span className="text-muted-foreground font-normal">· {year}</span></h2>
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1.5 max-w-2xl">
            One record per confirmed deduction: business purpose, attendees, travel details, mileage log and receipt references, with the IRS substantiation elements that are still missing. A records packet for you and your preparer, not audit representation or a guarantee.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          <Button variant="outline" size="sm" className="min-h-[40px]" disabled={loading || !!error || downloading !== null} onClick={() => onDownload('json')} title="JSON records packet, every plan">
            <Download className="w-4 h-4" /><span className="ml-1.5">JSON</span>
          </Button>
          <Button variant="outline" size="sm" className="min-h-[40px]" disabled={loading || !!error || downloading !== null} onClick={() => onDownload('csv')} title="CSV records packet, every plan">
            <Download className="w-4 h-4" /><span className="ml-1.5">CSV</span>
          </Button>
          <Button size="sm" className="min-h-[40px] bg-primary hover:bg-primary/90 text-primary-foreground" disabled={loading || !!error || downloading !== null} onClick={() => onDownload('pdf')} title={canDownloadPdf ? 'Formatted PDF packet' : 'The PDF packet requires Premium'}>
            {canDownloadPdf ? <Download className="w-4 h-4" /> : <Lock className="w-4 h-4" />}<span className="ml-1.5">PDF{canDownloadPdf ? '' : ' · Premium'}</span>
          </Button>
        </div>
      </div>

      {loading && <p className="text-sm text-muted-foreground mt-4" role="status">Checking your confirmed deductions for {year}…</p>}
      {!loading && error && (
        <div className="mt-4 text-sm">
          <p className="text-foreground">{error.message}</p>
          <div className="flex flex-wrap gap-2 mt-2">
            {error.code === 'EXPORT_REVIEW_REQUIRED' && (
              <a href="/protected/transactions" className="inline-flex items-center gap-1 text-primary underline underline-offset-2">Review transactions<ArrowRight className="w-3.5 h-3.5" /></a>
            )}
            <button type="button" onClick={onRetry} className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"><RefreshCw className="w-3.5 h-3.5" />Retry</button>
          </div>
        </div>
      )}
      {!loading && !error && summary && (
        <>
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-lg border border-border/60 bg-muted/30 p-3">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Complete</div>
              <div className="text-lg font-semibold tabular-nums text-[hsl(var(--success))]">{summary.byStatus.complete.count}</div>
              <div className="text-[10px] text-muted-foreground tabular-nums">{money(summary.byStatus.complete.amount)}</div>
            </div>
            <div className="rounded-lg border border-border/60 bg-muted/30 p-3">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Need records</div>
              <div className={`text-lg font-semibold tabular-nums ${summary.byStatus.needs_records.count ? 'text-amber-600 dark:text-amber-400' : 'text-foreground'}`}>{summary.byStatus.needs_records.count}</div>
              <div className="text-[10px] text-muted-foreground tabular-nums">{money(summary.byStatus.needs_records.amount)}</div>
            </div>
            <div className="rounded-lg border border-border/60 bg-muted/30 p-3">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Confirmed deductions</div>
              <div className="text-lg font-semibold tabular-nums text-foreground">{summary.deductionCount}</div>
              <div className="text-[10px] text-muted-foreground tabular-nums">{money(summary.recordedAmount)} recorded</div>
            </div>
            <div className="rounded-lg border border-border/60 bg-muted/30 p-3">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Mileage log</div>
              <div className="text-lg font-semibold tabular-nums text-foreground">{summary.mileage.tripCount}</div>
              <div className="text-[10px] text-muted-foreground tabular-nums">{summary.mileage.tripCount ? `${summary.mileage.ratedMiles} rated miles` : 'no trips this year'}{summary.mileage.tripsNeedingRecords ? ` · ${summary.mileage.tripsNeedingRecords} need details` : ''}</div>
            </div>
          </div>
          {summary.excluded.notConfirmed > 0 && (
            <p className="text-xs text-muted-foreground mt-3">
              {summary.excluded.notConfirmed} deductible record{summary.excluded.notConfirmed === 1 ? ' has' : 's have'} not been confirmed through the review flow and {summary.excluded.notConfirmed === 1 ? 'is' : 'are'} not included.
            </p>
          )}
          {needsRecords.length > 0 ? (
            <div className="mt-4">
              <div className="text-xs font-medium text-foreground mb-2">Items that still need records{summary.missingItems.length ? <span className="text-muted-foreground font-normal"> · most common: {summary.missingItems.slice(0, 3).map(item => `${item.item} (${item.count})`).join(', ')}</span> : null}</div>
              <ul className="divide-y divide-border/60 rounded-lg border border-border/60">
                {needsRecords.slice(0, MAX_LISTED).map(record => (
                  <li key={record.transactionId} className="flex items-center justify-between gap-3 p-2.5 text-sm">
                    <div className="min-w-0">
                      <div className="font-medium text-foreground truncate">{record.merchant} <span className="text-muted-foreground font-normal tabular-nums">· {record.date} · {money(record.amount)}</span></div>
                      <div className="text-xs text-amber-700 dark:text-amber-400 truncate">Missing: {record.substantiation.missing.join('; ')}</div>
                    </div>
                    <button type="button" onClick={() => onOpenTransaction(record.transactionId)} className="inline-flex items-center gap-1 text-xs text-primary hover:underline shrink-0 min-h-[36px]" aria-label={`Add records for ${record.merchant}`}>
                      Add records<ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
              {needsRecords.length > MAX_LISTED && <p className="text-xs text-muted-foreground mt-2">Showing {MAX_LISTED} of {needsRecords.length}. The CSV and PDF list every item.</p>}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground mt-3">{summary.deductionCount ? 'Every confirmed deduction has the records its category requires on file. Keep this packet with your return.' : `No confirmed deductions for ${year} yet. Confirm categories in the review flow to build the packet.`}</p>
          )}
        </>
      )}
    </Card>
  );
}

/** Loads the owner packet for the selected year and handles downloads and the Premium PDF gate. */
export function AuditSupportRecordsCard({ year, enabled = true }: { year: number; enabled?: boolean }) {
  const router = useRouter();
  const { canAccess, isLoading: subscriptionLoading } = useSubscription();
  const [packet, setPacket] = useState<AuditSupportSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [downloading, setDownloading] = useState<PacketFormat | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoading(true); setError(null);
    makeAuthenticatedRequest(`/api/reports/audit-support?year=${year}&format=json`)
      .then(async response => {
        const body = await response.json().catch(() => ({}));
        if (cancelled) return;
        if (!response.ok) { setPacket(null); setError({ message: body.error || 'Could not load your records packet. Please retry.', code: body.code }); return; }
        setPacket(body as AuditSupportSummary);
      })
      .catch(() => { if (!cancelled) { setPacket(null); setError({ message: 'Could not load your records packet. Please retry.' }); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [year, enabled, attempt]);

  const download = useCallback(async (format: PacketFormat) => {
    if (format === 'pdf' && !subscriptionLoading && !canAccess('reports')) {
      toast.warning('The formatted PDF packet requires Premium. JSON and CSV are included on every plan.');
      router.push('/protected/subscriptions');
      return;
    }
    setDownloading(format);
    try {
      const response = await makeAuthenticatedRequest(`/api/reports/audit-support?year=${year}&format=${format}`);
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        if (body.code === 'SUBSCRIPTION_REQUIRED') { toast.warning('The formatted PDF packet requires Premium.'); router.push('/protected/subscriptions'); return; }
        throw new Error(body.error || 'Could not prepare the records packet. Please retry.');
      }
      const blob = await response.blob();
      if (!blob.size) throw new Error('The records packet was empty. Please retry.');
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = `writeoff-audit-support-records-${year}.${format}`;
      document.body.appendChild(link); link.click(); link.remove();
      window.URL.revokeObjectURL(url);
    } catch (downloadError) {
      toast.error(downloadError instanceof Error ? downloadError.message : 'Could not prepare the records packet. Please retry.');
    } finally { setDownloading(null); }
  }, [year, canAccess, subscriptionLoading, router]);

  const openTransaction = useCallback((transactionId: string) => {
    router.push(protectedScreenUrl(`transaction-detail?transactionId=${encodeURIComponent(transactionId)}&from=reports`));
  }, [router]);

  if (!enabled) return null;
  return (
    <AuditSupportRecordsSummary year={year} packet={packet} loading={loading} error={error} canDownloadPdf={!subscriptionLoading && canAccess('reports')}
      downloading={downloading} onDownload={download} onOpenTransaction={openTransaction} onRetry={() => setAttempt(value => value + 1)} />
  );
}
