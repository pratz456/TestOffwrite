"use client";

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Download, FileText, Calendar, Lock, Sparkles } from 'lucide-react';
import { useSubscription } from '@/lib/hooks/use-subscription';
import { useRouter } from 'next/navigation';
import { aggregateScheduleC, CATEGORY_MAP } from '@/lib/schedule-c/aggregate';

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
  const { hasAccess, isTrial, isPaid, isLoading: subscriptionLoading, status: subscriptionStatus } = useSubscription();

  const [selectedYear, setSelectedYear] = useState('2025'); // Default to current year
  const [exportFormat, setExportFormat] = useState('CSV (Spreadsheet)');
  const [categorySummaries, setCategorySummaries] = useState<CategorySummary[]>([]);
  const [totalDeductible, setTotalDeductible] = useState(0);
  const [deductibleCount, setDeductibleCount] = useState(0);
  const [confirmedCount, setConfirmedCount] = useState(0);
  const [potentialCount, setPotentialCount] = useState(0);
  const [isExporting, setIsExporting] = useState(false);
  const [includeAppendix, setIncludeAppendix] = useState(true);
  const [lineDetails, setLineDetails] = useState<Record<string, { confirmed: number; potential: number; amount: number; transactions: Transaction[] }>>({});


  // Category mapping to Schedule C line items
  // Legacy mapping kept for historical UI logic; not used in the CPA-grade confirmed-only preview.
  // Kept intentionally to avoid disrupting older debugging flows.
  const _categoryToScheduleC: { [key: string]: string } = {
    // Meals
    'FOOD_AND_DRINK_COFFEE_SHOP': 'Meals',
    'FOOD_AND_DRINK_FAST_FOOD': 'Meals',
    'FOOD_AND_DRINK_RESTAURANT': 'Meals',
    'FOOD_AND_DRINK_ALCOHOL_AND_BARS': 'Meals',

    // Office expense
    'GENERAL_MERCHANDISE_OFFICE_SUPPLIES': 'Office expense',
    'GENERAL_MERCHANDISE_COMPUTERS_AND_ELECTRONICS': 'Office expense',
    'GENERAL_MERCHANDISE_HOME_IMPROVEMENT': 'Office expense',
    'GENERAL_MERCHANDISE_PHARMACY': 'Office expense',
    'GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE': 'Office expense',
    'SERVICE_SHIPPING': 'Office expense',
    'SERVICE_UTILITIES': 'Office expense',
    'SERVICE_STORAGE': 'Office expense',

    // Professional services
    'SERVICE_ACCOUNTING': 'Professional services',
    'SERVICE_CONSULTING': 'Professional services',
    'SERVICE_LEGAL': 'Professional services',
    'SERVICE_MARKETING': 'Professional services',
    'SERVICE_ADVERTISING': 'Professional services',
    'SERVICE_SECURITY': 'Professional services',
    'SERVICE_INSURANCE': 'Professional services',

    // Car and truck expenses
    'TRANSPORTATION_RIDESHARE': 'Car and truck expenses',
    'TRANSPORTATION_AUTO_PARKING': 'Car and truck expenses',
    'TRANSPORTATION_AUTO_REPAIR': 'Car and truck expenses',
    'TRANSPORTATION_AUTO_SERVICE': 'Car and truck expenses',
    'TRANSPORTATION_FUEL': 'Car and truck expenses',
    'TRANSPORTATION_TOLLS': 'Car and truck expenses',
    'TRANSPORTATION_AUTO_INSURANCE': 'Car and truck expenses',

    // Travel
    'TRAVEL_FLIGHTS': 'Travel',
    'TRAVEL_LODGING': 'Travel',
    'TRAVEL_OTHER_TRAVEL': 'Travel',

    // Other expenses
    'ENTERTAINMENT_SPORTS_AND_OUTDOORS': 'Other expenses',
    'ENTERTAINMENT_ARTS': 'Other expenses',
    'ENTERTAINMENT_THEATER': 'Other expenses',
    'ENTERTAINMENT_MUSIC': 'Other expenses',
    'ENTERTAINMENT_MOVIES_AND_DVDS': 'Other expenses',
    'GENERAL_MERCHANDISE_SPORTING_GOODS': 'Other expenses',
    'PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS': 'Other expenses',
    'COMMUNITY_CHARITY': 'Other expenses',
    'COMMUNITY_EDUCATION': 'Other expenses',
    'COMMUNITY_RELIGIOUS': 'Other expenses',
  };

  const potentialBusinessCategories = [
    // Meals
    'FOOD_AND_DRINK_COFFEE_SHOP',
    'FOOD_AND_DRINK_FAST_FOOD',
    'FOOD_AND_DRINK_RESTAURANT',
    'FOOD_AND_DRINK_ALCOHOL_AND_BARS',

    // Office expense
    'GENERAL_MERCHANDISE_OFFICE_SUPPLIES',
    'GENERAL_MERCHANDISE_COMPUTERS_AND_ELECTRONICS',
    'GENERAL_MERCHANDISE_HOME_IMPROVEMENT',
    'GENERAL_MERCHANDISE_PHARMACY',
    'GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE',
    'SERVICE_SHIPPING',
    'SERVICE_UTILITIES',
    'SERVICE_STORAGE',

    // Professional services
    'SERVICE_ACCOUNTING',
    'SERVICE_CONSULTING',
    'SERVICE_LEGAL',
    'SERVICE_MARKETING',
    'SERVICE_ADVERTISING',
    'SERVICE_SECURITY',
    'SERVICE_INSURANCE',

    // Car and truck expenses
    'TRANSPORTATION_RIDESHARE',
    'TRANSPORTATION_AUTO_PARKING',
    'TRANSPORTATION_AUTO_REPAIR',
    'TRANSPORTATION_AUTO_SERVICE',
    'TRANSPORTATION_FUEL',
    'TRANSPORTATION_TOLLS',
    'TRANSPORTATION_AUTO_INSURANCE',

    // Travel
    'TRAVEL_FLIGHTS',
    'TRAVEL_LODGING',
    'TRAVEL_OTHER_TRAVEL',

    // Other expenses
    'ENTERTAINMENT_SPORTS_AND_OUTDOORS',
    'ENTERTAINMENT_ARTS',
    'ENTERTAINMENT_THEATER',
    'ENTERTAINMENT_MUSIC',
    'ENTERTAINMENT_MOVIES_AND_DVDS',
    'GENERAL_MERCHANDISE_SPORTING_GOODS',
    'PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS',
    'COMMUNITY_CHARITY',
    'COMMUNITY_EDUCATION',
    'COMMUNITY_RELIGIOUS',
  ];

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
    // Optionally refresh latest year transactions from Supabase for most up-to-date preview
    // (non-blocking; silently fails if RLS prevents)
    const fetchLatest = async () => {
      try {
        if (!user) return;

        const { makeAuthenticatedRequest } = await import('@/lib/firebase/api-client');
        const response = await makeAuthenticatedRequest('/api/transactions');
        const result = await response.json();
        const allTransactions = result.transactions || [];

        // Filter by year
        const start = `${selectedYear}-01-01`;
        const end = `${selectedYear}-12-31`;
        const data = allTransactions.filter((t: any) => t.date >= start && t.date <= end);

        if (data && Array.isArray(data) && data.length > 0) {
          // Map trans_id -> id for internal consistency if needed
          const mapped = data.map((t: any) => ({
            id: t.trans_id || t.id,
            merchant_name: t.merchant_name,
            amount: t.amount,
            category: t.category,
            date: t.date,
            type: t.type,
            is_deductible: t.is_deductible,
            pending: t.pending ?? null,
            deductible_reason: t.deductible_reason,
            deduction_score: t.deduction_score,
            description: t.description,
            notes: t.notes,
          }));
          // Re-run calculation with freshest data merged (prefer latest for selected year)
          calculateDeductions(mapped as any);
        }
      } catch (e) {
        // silent
      }
    };
    fetchLatest();
    // Debug logging
    console.log('🔍 Schedule C Debug Info:', {
      totalTransactions: transactions.length,
      selectedYear,
      yearTransactions: transactions.filter(t => new Date(t.date).getFullYear().toString() === selectedYear).length,
      deductibleTypes: transactions.reduce((acc, t) => {
        const key = t.is_deductible === null ? 'null' : t.is_deductible ? 'true' : 'false';
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {} as any),
      businessCategoryCount: transactions.filter(t =>
        potentialBusinessCategories.includes(t.category) &&
        new Date(t.date).getFullYear().toString() === selectedYear &&
        t.amount > 0
      ).length,
      sampleTransactions: transactions.slice(0, 3).map(t => ({
        merchant: t.merchant_name,
        amount: t.amount,
        category: t.category,
        is_deductible: t.is_deductible,
        date: t.date
      }))
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactionsKey, selectedYear, user]);

  const lineNameToLineCode = useMemo(() => {
    const map: Record<string, string> = {};
    for (const entry of Object.values(CATEGORY_MAP)) {
      map[entry.name] = entry.line;
    }
    return map;
  }, []);

  const getScheduleCLineNumber = (lineItem: string): string => {
    return lineNameToLineCode[lineItem] || '27a';
  };

  const handleExport = async () => {
    setIsExporting(true);

    try {
      // Confirmed-only export: `lineDetails` was computed from the shared aggregateScheduleC() confirmed-only mode,
      // so it already includes exactly the transactions contributing to the Schedule C totals.
      const includedTransactions = Object.values(lineDetails).flatMap(d => d.transactions);

      // Prepare export data
      const exportData = {
        year: selectedYear,
        format: exportFormat,
        summary: {
          confirmedDeductible: includedTransactions.length,
          potentiallyDeductible: 0,
          totalTransactions: includedTransactions.length,
          scheduleCCategories: categorySummaries.length,
          totalBusinessExpenses: totalDeductible
        },
        categories: categorySummaries,
        transactions: includedTransactions,
        lineDetails
      };

      if (exportFormat === 'CSV (Spreadsheet)') {
        // Generate CSV
        const csvContent = generateCSV(exportData);
        downloadFile(csvContent, `schedule-c-${selectedYear}.csv`, 'text/csv');
      } else {
        // Generate PDF
        await generatePDF(exportData);
      }
    } catch (error) {
      console.error('Export error:', error);
      toast.error('Failed to export data. Please try again.');
    } finally {
      setIsExporting(false);
    }
  };

  // Helper function to properly escape CSV values
  const escapeCsvValue = (value: any): string => {
    if (value === null || value === undefined) return '""';
    const stringValue = String(value);
    // Escape internal quotes by doubling them, then wrap in quotes
    // This handles: commas, quotes, newlines, and special characters
    const escaped = stringValue.replace(/"/g, '""');
    return `"${escaped}"`;
  };

  const generateCSV = (data: any): string => {
    const halfCentsAwayFromZero = (cents: number): number => {
      const abs = Math.abs(cents);
      const half = Math.floor(abs / 2);
      const extra = abs % 2;
      const rounded = half + extra;
      return cents < 0 ? -rounded : rounded;
    };

    const headers = [
      'Date',
      'Merchant',
      'Category',
      'Schedule C Line',
      'Amount',
      'Status',
      'Description'
    ];

    const rows = data.transactions.map((t: Transaction) => {
      const lineCode = CATEGORY_MAP[t.category]?.line || '27a';
      const cents = Math.round((t.amount ?? 0) * 100); // signed cents for credits/refunds
      const contributionCents = lineCode === '24b' ? halfCentsAwayFromZero(cents) : cents;
      const contribution = contributionCents / 100;

      return [
        t.date,
        t.merchant_name,
        t.category,
        lineCode,
        contribution.toFixed(2),
        'Confirmed Deductible',
        t.description || t.deductible_reason || t.notes || ''
      ];
    });

    return [headers, ...rows].map(row =>
      row.map((field: any) => escapeCsvValue(field)).join(',')
    ).join('\n');
  };

  const generatePDF = async (data: any) => {
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
          includeAppendix
        }),
      });

      if (!response.ok) {
        // Check if it's a subscription required error
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          const errorData = await response.json();
          if (errorData.requiresSubscription) {
            toast.warning('An active subscription is required to export Schedule C reports. Please subscribe to access this feature.');
            router.push('/protected/subscriptions');
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
      link.download = `Schedule_C_${selectedYear}_WriteOff.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

    } catch (error) {
      console.error('PDF generation error:', error);
      toast.error('Failed to generate PDF. Please try again.');
    }
  };

  const downloadFile = (content: string, filename: string, contentType: string) => {
    const blob = new Blob([content], { type: contentType });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  };

  const formatCurrency = (amount: number): string => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  };

  return (
    <div className="min-h-screen bg-background min-w-0 overflow-x-hidden">
      {/* Header */}
      <div className="bg-card border-b border-border sticky top-0 z-50 shadow-sm min-w-0">
        <div className="flex items-center justify-between p-4 sm:p-6 min-w-0">
          <button
            onClick={onBack}
            className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 rounded min-h-[44px] min-w-[44px] justify-center"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="text-center">
            <h1 className="text-xl font-semibold text-foreground">Schedule C Export</h1>
            <p className="text-sm text-muted-foreground">Export your business expenses for tax filing</p>
          </div>
          <div className="w-12" />
        </div>
      </div>

      <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-6 min-w-0">
        {/* Export Configuration */}
        <Card className="p-4 sm:p-6 bg-card border border-border shadow-sm min-w-0">
          <div className="grid grid-cols-1 sm:grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
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
                <option value="2025">2025</option>
                <option value="2024">2024</option>
                <option value="2023">2023</option>
                <option value="2022">2022</option>
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
          <div className="mt-4 sm:mt-6 w-full">
            {!subscriptionLoading && !hasAccess ? (
              <Button
                disabled
                className="w-full min-h-[44px] h-12 bg-muted text-muted-foreground rounded-lg cursor-not-allowed flex items-center justify-center gap-2"
              >
                <Lock className="w-5 h-5" />
                Subscription Required to Export
              </Button>
            ) : (
              <Button
                onClick={handleExport}
                disabled={isExporting || categorySummaries.length === 0 || subscriptionLoading}
                className="w-full min-h-[44px] h-12 font-medium rounded-lg flex items-center justify-center gap-2 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              >
                <Download className="w-5 h-5" />
                {isExporting ? 'Exporting...' : `Export ${selectedYear} Schedule C Data`}
              </Button>
            )}
          </div>
        </Card>

        {/* Subscription Required Banner */}
        {!subscriptionLoading && !hasAccess && (
          <Card className="p-6 bg-gradient-to-r from-purple-50 to-blue-50 dark:from-purple-900/30 dark:to-blue-900/30 border border-purple-200 dark:border-purple-700 shadow-sm">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-purple-100 dark:bg-purple-800/50 rounded-xl">
                <Sparkles className="w-6 h-6 text-purple-600 dark:text-purple-400" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-foreground mb-1">
                  Unlock Schedule C Export
                </h3>
                <p className="text-muted-foreground mb-4">
                  Subscribe to download your Schedule C data as PDF or CSV. Get organized tax reports ready for your accountant or tax software.
                </p>
                <div className="flex flex-wrap gap-3">
                  <Button
                    onClick={() => router.push('/protected/subscriptions')}
                    className="bg-gradient-to-r from-purple-500 to-purple-600 dark:from-purple-500 dark:to-purple-600 hover:from-purple-600 hover:to-purple-700 text-white font-medium shadow-md shadow-purple-500/20 dark:shadow-purple-500/30 transition-all duration-200"
                  >
                    <Sparkles className="w-4 h-4 mr-2" />
                    Subscribe Now
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => router.push('/protected/subscriptions')}
                    className="border-2 border-purple-300 dark:border-purple-500 text-purple-700 dark:text-purple-300 bg-card hover:bg-purple-50 dark:hover:bg-purple-900/30 transition-all duration-200"
                  >
                    View Plans
                  </Button>
                </div>
              </div>
            </div>
          </Card>
        )}

        {/* Schedule C Preview */}
        <Card className="p-4 sm:p-6 bg-card border border-border shadow-sm min-w-0 overflow-hidden">
          <h3 className="text-lg font-semibold text-foreground mb-6">
            Schedule C Preview - Tax Year {selectedYear}
          </h3>

          {/* Enhanced Form Style Preview */}
          {categorySummaries.length > 0 && (
            <div className="mb-10">
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
              <p className="mt-2 text-xs text-muted-foreground">This table is a dynamic approximation for planning. Always verify with the official IRS form and a tax professional.</p>
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
        <Card className="p-4 sm:p-6 bg-card border border-border shadow-sm min-w-0">
          <h4 className="text-lg font-semibold text-foreground mb-3">How to use this export:</h4>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li>• Download the CSV file and open it in Excel or Google Sheets</li>
            <li>• Use the Schedule C line numbers to enter amounts in your tax software</li>
            <li>• Keep the detailed transaction records for your tax files</li>
            <li>• Consult with your tax professional for proper filing</li>
          </ul>

          {potentialCount > 0 && (
            <div className="mt-4 p-3 bg-muted border border-border rounded-lg">
              <p className="text-foreground font-medium text-sm">
                📝 Note: This export includes {potentialCount} potentially deductible transactions that haven't been confirmed yet.
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
