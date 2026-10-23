"use client";

import { scheduleCExportLine } from '@/lib/schedule-c/export-lines';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Download, FileText, Calendar, Lock } from 'lucide-react';
import { useSubscription } from '@/lib/hooks/use-subscription';
import { PremiumFeatureGate, subscriptionGateDestination } from '@/components/premium-feature-gate';
import { useRouter } from 'next/navigation';
import { aggregateScheduleC, CATEGORY_MAP } from '@/lib/schedule-c/aggregate';
import { SUPPORTED_TAX_YEARS } from '@/lib/tax-rules/federal-year-rules';

interface Transaction {
  id: string;
  merchant_name: string;
  amount: number;
  category: string;
  date: string;
  type?: 'expense' | 'income';
  is_deductible?: boolean | null;
  deductible_reason?: string;
  deduction_score?: number;
  description?: string;
  notes?: string;
  pending?: boolean | null;
}

interface ScheduleCExportScreenProps {
  user: {
    id: string;
    email?: string;
    user_metadata?: {
      name?: string;
    };
  };
  onBack: () => void;
  transactions: Transaction[];
}

interface CategorySummary {
  category: string;
  lineCode?: string;
  lineItem: string;
  amount: number;
  transactionCount: number;
}

export const ScheduleCExportScreen: React.FC<ScheduleCExportScreenProps> = ({
  user,
  onBack,
  transactions: transactionsProp
}) => {
  // Ensure transactions is always an array
  const transactions = Array.isArray(transactionsProp) ? transactionsProp : [];
  const router = useRouter();
  
  // Check subscription status for feature gating
  const { canAccess, isLoading: subscriptionLoading, status: subscriptionStatus } = useSubscription();
  const hasAccess = canAccess('exports');

  const [selectedYear, setSelectedYear] = useState(() => String(
    SUPPORTED_TAX_YEARS.find(year => year === new Date().getFullYear()) ?? SUPPORTED_TAX_YEARS[SUPPORTED_TAX_YEARS.length - 1]
  ));
  const [exportFormat, setExportFormat] = useState('CSV (Spreadsheet)');
  const [categorySummaries, setCategorySummaries] = useState<CategorySummary[]>([]);
  const [totalDeductible, setTotalDeductible] = useState(0);
  const [deductibleCount, setDeductibleCount] = useState(0);
  const [confirmedCount, setConfirmedCount] = useState(0);
  const [potentialCount, setPotentialCount] = useState(0);
  const [isExporting, setIsExporting] = useState(false);
  const [includeAppendix, setIncludeAppendix] = useState(true);
  const [lineDetails, setLineDetails] = useState<Record<string, { confirmed: number; potential: number; amount: number; transactions: Transaction[] }>>({});


  // Memoize transactions array reference to prevent unnecessary re-renders
  const transactionsKey = useMemo(() => {
    return transactions.map(t => `${t.id}-${t.date}-${t.amount}-${t.is_deductible}-${String(t.pending ?? '')}`).join('|');
  }, [transactions]);

  // Memoize calculateDeductions to prevent recreation on every render
  const calculateDeductions = useCallback((overrideYearTx?: Transaction[]) => {
    // Use shared CPA-grade Schedule C aggregation logic.
    // confirmed-only excludes is_deductible === null/undefined and nets credits/refunds via signed totals.
    const sourceTx = Array.isArray(overrideYearTx) ? overrideYearTx : (Array.isArray(transactions) ? transactions : []);
    const aggregation = aggregateScheduleC(sourceTx as any[], selectedYear, CATEGORY_MAP, { mode: 'confirmed-only' });

    const nextLineDetails: Record<string, { confirmed: number; potential: number; amount: number; transactions: Transaction[] }> = {};
    aggregation.lineItemsArray.forEach((item) => {
      nextLineDetails[item.lineName] = {
        confirmed: item.transactionCount,
        potential: 0,
        amount: item.deductible,
        transactions: item.transactions as Transaction[],
      };
    });
    setLineDetails(nextLineDetails);

    const summaries: CategorySummary[] = aggregation.lineItemsArray
      .map((item) => ({
        category: item.lineName,
        lineCode: item.lineCode,
        lineItem: item.lineName,
        amount: item.deductible,
        transactionCount: item.transactionCount,
      }))
      // UI currently sorts by descending magnitude.
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));

    setCategorySummaries(summaries);
    setTotalDeductible(aggregation.totalDeductible);
    setDeductibleCount(aggregation.counts.deductible);
    setConfirmedCount(aggregation.counts.deductible);
    setPotentialCount(0);
  }, [transactions, selectedYear]);

  useEffect(() => {
    calculateDeductions();
    // This preview reflects loaded records. The PDF reloads complete saved data
    // server-side for both formats.
  }, [calculateDeductions, transactionsKey]);

  const lineNameToLineCode = useMemo(() => {
    const map: Record<string, string> = {};
    for (const entry of Object.values(CATEGORY_MAP)) {
      map[entry.name] = entry.line;
    }
    return map;
  }, []);

  const getScheduleCLineNumber = (lineItem: string): string => {
    return scheduleCExportLine(lineNameToLineCode[lineItem] || '27a', Number(selectedYear));
  };

  const handleExport = async () => {
    if (!canAccess('exports')) {
      router.push(subscriptionGateDestination(subscriptionStatus));
      return;
    }
    setIsExporting(true);
    try { await generateDownload(); }
    finally { setIsExporting(false); }
  };

  const generateDownload = async () => {
    try {
      const { auth } = await import('@/lib/firebase/client');
      const currentUser = auth.currentUser;
      if (!currentUser) {
        throw new Error('User not authenticated. Please log in again.');
      }
      const token = await currentUser.getIdToken();

      const response = await fetch('/api/tax/schedule-c/export', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        credentials: 'include',
        body: JSON.stringify({
          year: selectedYear,
          includeAppendix,
          format: exportFormat === 'CSV (Spreadsheet)' ? 'csv' : 'pdf'
        }),
      });

      if (!response.ok) {
        // Check if it's a subscription required error
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          const errorData = await response.json();
          if (errorData.requiresSubscription || errorData.code === 'SUBSCRIPTION_REQUIRED') {
            toast.warning('Schedule C exports require an active Premium plan or trial. Review your billing and plan access.');
            router.push(subscriptionGateDestination(subscriptionStatus));
            return;
          }
          throw new Error(errorData.message || errorData.error || `PDF generation failed: ${response.statusText}`);
        }
        throw new Error(`PDF generation failed: ${response.statusText}`);
      }

      // Get the PDF blob
      const pdfBlob = await response.blob();

      // Create download link
      const url = window.URL.createObjectURL(pdfBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `Schedule_C_${selectedYear}_WriteOff.${exportFormat === 'CSV (Spreadsheet)' ? 'csv' : 'pdf'}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

    } catch (error) {
      console.error('PDF generation error:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to generate PDF. Please try again.');
    }
  };

  const formatCurrency = (amount: number): string => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  };

  return (
    <div className="min-h-full bg-background min-w-0 overflow-x-hidden">
      {/* Header */}
      <div className="bg-card border-b border-border sticky top-0 z-50 shadow-sm min-w-0">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6 min-w-0">
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold text-foreground">Schedule C Export</h1>
            <p className="text-sm text-muted-foreground">Download business records for preparer review</p>
          </div>
        </div>
      </div>

      <div className="px-4 py-4 sm:px-6 max-w-6xl mx-auto space-y-4 min-w-0">
        {/* Export Configuration */}
        <Card className="p-4 bg-card border border-border shadow-sm min-w-0">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Tax Year */}
            <div className="min-w-0 w-full">
              <label className="block text-sm font-medium text-foreground mb-2">
                Tax Year
              </label>
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(e.target.value)}
                className="w-full min-h-[44px] p-3 border border-input rounded-lg bg-background text-foreground focus:ring-2 focus:ring-primary focus:border-primary focus:outline-none"
              >
                {[...SUPPORTED_TAX_YEARS].reverse().map(year => <option key={year} value={String(year)}>{year}</option>)}
              </select>
            </div>

            {/* Export Format */}
            <div className="min-w-0 w-full">
              <label className="block text-sm font-medium text-foreground mb-2">
                Export Format
              </label>
              <select
                value={exportFormat}
                onChange={(e) => setExportFormat(e.target.value)}
                className="w-full min-h-[44px] p-3 border border-input rounded-lg bg-background text-foreground focus:ring-2 focus:ring-primary focus:border-primary focus:outline-none"
              >
                <option value="CSV (Spreadsheet)">CSV (Spreadsheet)</option>
                <option value="PDF">PDF</option>
              </select>
            </div>
          </div>

          {/* Include Detailed Appendix toggle (PDF only) */}
          {exportFormat === 'PDF' && (
            <div className="col-span-1 md:col-span-2 flex items-center gap-3 pt-2">
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeAppendix}
                  onChange={(e) => setIncludeAppendix(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-muted peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"></div>
              </label>
              <div>
                <span className="text-sm font-medium text-foreground">Include Detailed Appendix</span>
                <p className="text-xs text-muted-foreground">
                  {includeAppendix
                    ? 'PDF will include full transaction detail by Schedule C line.'
                    : 'PDF will include summary and breakdown only (no transaction detail).'}
                </p>
              </div>
            </div>
          )}

          {/* Export Button */}
          <div className="mt-4 w-full">
            {!subscriptionLoading && !hasAccess ? (
              <Button
                disabled
                className="w-full min-h-[44px] h-11 bg-muted text-muted-foreground rounded-lg cursor-not-allowed flex items-center justify-center gap-2"
              >
                <Lock className="w-5 h-5" />
                Subscription Required to Export
              </Button>
            ) : (
              <Button
                onClick={handleExport}
                disabled={isExporting || subscriptionLoading}
                className="w-full min-h-[44px] h-11 font-medium rounded-lg flex items-center justify-center gap-2 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              >
                <Download className="w-5 h-5" />
                {isExporting ? 'Exporting...' : `Export ${selectedYear} Schedule C Data`}
              </Button>
            )}
          </div>
        </Card>

        {/* Subscription Required Banner */}
        {!subscriptionLoading && !hasAccess && (
          <PremiumFeatureGate feature="exports" featureName="Schedule C exports"
            featureDescription="Download Schedule C data as PDF or CSV with an active Premium plan or trial.">
            {null}
          </PremiumFeatureGate>
        )}

        {/* Schedule C Preview */}
        <Card className="p-4 bg-card border border-border shadow-sm min-w-0 overflow-hidden">
          <h3 className="text-lg font-semibold text-foreground mb-4">
            Schedule C Preview - Tax Year {selectedYear}
          </h3>

          {/* Enhanced Form Style Preview */}
          {categorySummaries.length > 0 && (
            <div className="mb-4">
              <div className="mb-4">
                <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Form 1040 - Schedule C (Draft Preview)</h4>
                <p className="text-xs text-muted-foreground">Part II - Expenses (aggregated from your classified and potential business transactions)</p>
              </div>
              <div className="overflow-x-auto max-w-full rounded-lg border border-border">
                <table className="w-full min-w-[480px] text-sm">
                  <thead className="bg-muted text-muted-foreground text-xs uppercase">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Line</th>
                      <th className="px-3 py-2 text-left font-medium">Expense Category</th>
                      <th className="px-3 py-2 text-right font-medium">Amount</th>
                      <th className="px-3 py-2 text-right font-medium">% of Total</th>
                      <th className="px-3 py-2 text-right font-medium">Confirmed</th>
                      <th className="px-3 py-2 text-right font-medium">Potential</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border bg-card/60">
                    {categorySummaries.map(summary => {
                      const line = getScheduleCLineNumber(summary.lineItem);
                      const det = lineDetails[summary.lineItem];
                      const pct = totalDeductible > 0 ? (summary.amount / totalDeductible) * 100 : 0;
                      return (
                        <tr key={summary.lineItem} className="hover:bg-muted/50 transition-colors">
                          <td className="px-3 py-2 font-mono text-xs text-foreground tabular-nums">{line}</td>
                          <td className="px-3 py-2 text-foreground">{summary.lineItem}</td>
                          <td className="px-3 py-2 text-right font-medium text-foreground tabular-nums">{formatCurrency(summary.amount)}</td>
                          <td className="px-3 py-2 text-right text-muted-foreground tabular-nums">{pct.toFixed(1)}%</td>
                          <td className="px-3 py-2 text-right text-emerald-600 dark:text-emerald-400 font-medium tabular-nums">{det?.confirmed || 0}</td>
                          <td className="px-3 py-2 text-right text-amber-600 dark:text-amber-400 font-medium tabular-nums">{det?.potential || 0}</td>
                        </tr>
                      );
                    })}
                    <tr className="bg-muted font-semibold">
                      <td className="px-3 py-2 font-mono text-xs tabular-nums">28</td>
                      <td className="px-3 py-2">Total Expenses</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(totalDeductible)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">100%</td>
                      <td className="px-3 py-2 text-right tabular-nums">{Object.values(lineDetails).reduce((s,d)=>s+d.confirmed,0)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{Object.values(lineDetails).reduce((s,d)=>s+d.potential,0)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">Planning records only, not a complete or fileable Schedule C. Confirm income adjustments, COGS, vehicle methods, asset purchases and home-office treatment. For 2026, line references follow the published 2025 form pending the final form.</p>
            </div>
          )}

          {/* Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <div className="bg-card rounded-xl p-4 border border-border">
              <div className="text-2xl font-bold text-foreground mb-1 tabular-nums">{confirmedCount}</div>
              <div className="text-sm text-muted-foreground">Confirmed Deductible</div>
            </div>

            <div className="bg-card rounded-xl p-4 border border-border">
              <div className="text-2xl font-bold text-foreground mb-1 tabular-nums">{potentialCount}</div>
              <div className="text-sm text-muted-foreground">Needs Review</div>
            </div>

            <div className="bg-card rounded-xl p-4 border border-border">
              <div className="text-2xl font-bold text-foreground mb-1 tabular-nums">{categorySummaries.length}</div>
              <div className="text-sm text-muted-foreground">Schedule C Categories</div>
            </div>

            <div className="bg-card rounded-xl p-4 border border-border">
              <div className="text-2xl font-bold text-foreground mb-1 tabular-nums">{formatCurrency(totalDeductible)}</div>
              <div className="text-sm text-muted-foreground">Total Business Expenses</div>
            </div>
          </div>

          {/* IRS Schedule C Line Items */}
          <div>
            <h4 className="text-lg font-semibold text-foreground mb-4">IRS Schedule C Line Items</h4>

            {categorySummaries.length > 0 ? (
              <div className="space-y-3">
                {categorySummaries.map((category, index) => (
                  <div key={index} className="flex items-center justify-between p-4 bg-muted/50 rounded-lg border border-border">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-primary text-primary-foreground rounded-lg flex items-center justify-center text-sm font-bold">
                        {getScheduleCLineNumber(category.lineItem)}
                      </div>
                      <div>
                        <div className="font-medium text-foreground">{category.lineItem}</div>
                        <div className="text-sm text-muted-foreground">
                          {category.transactionCount} transaction{category.transactionCount !== 1 ? 's' : ''}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-bold text-foreground tabular-nums">
                        {formatCurrency(category.amount)}
                      </div>
                    </div>
                  </div>
                ))}

                {/* Total */}
                <div className="border-t border-border pt-4 mt-4">
                  <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg border border-border">
                    <div className="font-bold text-foreground">
                      Total Business Expenses (Line 28)
                    </div>
                    <div className="text-xl font-bold text-foreground tabular-nums">
                      {formatCurrency(totalDeductible)}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <FileText className="w-12 h-12 mx-auto mb-3 text-muted-foreground/70" />
                <p>No deductible business expenses found for {selectedYear}</p>
                <p className="text-sm mb-4 text-muted-foreground/70">Make sure to categorize your transactions as business expenses first.</p>
                {potentialCount > 0 && (
                  <div className="bg-muted border border-border rounded-lg p-4 mt-4 text-foreground">
                    <p className="font-medium">💡 Found {potentialCount} transactions that might be deductible</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      Go to "Review Transactions" to classify these as business expenses.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </Card>

        {/* Instructions */}
        <Card className="p-4 bg-card border border-border shadow-sm min-w-0">
          <h4 className="text-lg font-semibold text-foreground mb-3">How to use this export:</h4>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li>• Download the CSV file and open it in Excel or Google Sheets</li>
            <li>• Have your preparer verify each amount, category and tax-year line reference before entering it</li>
            <li>• Keep the detailed transaction records for your tax files</li>
            <li>• Consult with your tax professional for proper filing</li>
          </ul>

          {potentialCount > 0 && (
            <div className="mt-4 p-3 bg-muted border border-border rounded-lg">
              <p className="text-foreground font-medium text-sm">
                📝 Note: This export excludes {potentialCount} unconfirmed transactions. Confirm any eligible expenses before exporting.
                Review these in the "Review Transactions" section before filing.
              </p>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
};

export default ScheduleCExportScreen;
