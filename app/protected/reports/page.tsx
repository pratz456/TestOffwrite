"use client";

import React, { useState, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { FileText, TrendingUp, TrendingDown, Calendar, BarChart3, AlertCircle, Download, Eye, X, Filter, ChevronDown, DollarSign, ArrowUpRight, ArrowDownRight, Info, RefreshCw, Target, Lock, Sparkles } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/firebase/auth-context';
import { useMonthlyDeductions } from '@/lib/react-query/hooks';
import { ReportsChartSkeleton, PageHeaderSkeleton } from '@/components/ui/skeleton';
import { OtherReportsDropdown } from './components/OtherReportsDropdown';
import { ToastContainer, useToasts } from '@/components/ui/toast';
import { useSubscription } from '@/lib/hooks/use-subscription';

interface MonthlyData {
  month: number;
  monthName: string;
  total: number;
  count: number;
}

interface ReportsData {
  monthlyData: MonthlyData[];
  summary: {
    currentMonthTotal: number;
    monthOverMonthChange: number;
    avgMonthly: number;
    monthsWithData: number;
    yearToDateTotal: number;
    estimatedRefund: number;
  };
  /** Years that have transaction activity (for year selector); may be absent from older API */
  availableYears?: number[];
}

interface TransactionDetail {
  id: string;
  date: string;
  amount: number;
  merchant_name: string;
  category: string;
  is_deductible: boolean;
  deduction_score?: number;
}

interface MonthlyBreakdown {
  month: string;
  monthName: string;
  total: number;
  transactionCount: number;
  transactions: TransactionDetail[];
  categoryBreakdown: Record<string, number>;
}

export default function ReportsPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [activeTab, setActiveTab] = useState('overview');
  const [selectedMonth, setSelectedMonth] = useState<MonthlyBreakdown | null>(null);
  const [showMonthlyModal, setShowMonthlyModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportFormat, setExportFormat] = useState<'PDF' | 'CSV'>('PDF');
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const currentYear = new Date().getFullYear();
  const [chartYear, setChartYear] = useState(currentYear);
  const { toasts, removeToast } = useToasts();
  
  // Check subscription status for feature gating
  const { hasAccess, isLoading: subscriptionLoading } = useSubscription();

  // Use React Query for data fetching with caching (year param for viewing previous years)
  const {
    data: reportsResult,
    isLoading,
    error,
    refetch
  } = useMonthlyDeductions(user?.id || '', chartYear);

  const reportsData = reportsResult?.data as ReportsData | undefined;

  // Calculate additional metrics
  const metrics = useMemo(() => {
    if (!reportsData) return null;

    const { monthlyData, summary } = reportsData;
    const dataValues = monthlyData.map(m => m.total).filter(val => val > 0);
    const dataMax = Math.max(...dataValues, 0);
    const currentMonth = new Date().getMonth();

    // Find best and worst months
    const monthsWithData = monthlyData.filter(m => m.total > 0);
    const bestMonth = monthsWithData.reduce((best, current) =>
      current.total > best.total ? current : best, monthsWithData[0] || { monthName: 'N/A', total: 0 });
    const worstMonth = monthsWithData.reduce((worst, current) =>
      current.total < worst.total ? current : worst, monthsWithData[0] || { monthName: 'N/A', total: 0 });

    // Calculate trend (comparing last 3 months average to previous 3 months)
    const last3Months = monthlyData.slice(Math.max(0, currentMonth - 2), currentMonth + 1);
    const prev3Months = monthlyData.slice(Math.max(0, currentMonth - 5), Math.max(0, currentMonth - 2));
    const last3Avg = last3Months.reduce((sum, m) => sum + m.total, 0) / Math.max(last3Months.length, 1);
    const prev3Avg = prev3Months.reduce((sum, m) => sum + m.total, 0) / Math.max(prev3Months.length, 1);
    const trend = prev3Avg > 0 ? ((last3Avg - prev3Avg) / prev3Avg) * 100 : 0;

    // Projected annual savings
    const projectedAnnual = summary.avgMonthly * 12;

    // Fix month-over-month change display
    const monthOverMonthChange = summary.monthOverMonthChange || 0;
    const isPositiveChange = monthOverMonthChange >= 0;

    return {
      dataMax,
      bestMonth,
      worstMonth,
      trend,
      projectedAnnual,
      monthOverMonthChange,
      isPositiveChange,
      last3Avg,
      prev3Avg
    };
  }, [reportsData]);

  // Years that have transaction activity (from API); fallback to current year while loading
  const availableYears = reportsData?.availableYears ?? [currentYear];

  // When available years load, if current chartYear isn't in the list, switch to most recent available
  useEffect(() => {
    if (reportsData?.availableYears && reportsData.availableYears.length > 0 && !reportsData.availableYears.includes(chartYear)) {
      setChartYear(reportsData.availableYears[0]);
    }
  }, [reportsData?.availableYears, chartYear]);

  // Function to handle monthly breakdown
  const handleMonthClick = async (monthData: MonthlyData) => {
    try {
      // Fetch detailed transactions for the selected month
      const response = await fetch(`/api/transactions?month=${monthData.month}&year=${chartYear}`);
      const { data: transactions } = await response.json();

      // Filter for deductible transactions
      const deductibleTransactions = transactions?.filter((t: TransactionDetail) => t.is_deductible === true) || [];

      // Calculate category breakdown
      const categoryBreakdown: Record<string, number> = {};
      deductibleTransactions.forEach((transaction: TransactionDetail) => {
        const category = transaction.category || 'Uncategorized';
        categoryBreakdown[category] = (categoryBreakdown[category] || 0) + Math.abs(transaction.amount);
      });

      const monthlyBreakdown: MonthlyBreakdown = {
        month: monthData.month.toString(),
        monthName: monthData.monthName,
        total: monthData.total,
        transactionCount: monthData.count,
        transactions: deductibleTransactions,
        categoryBreakdown
      };

      setSelectedMonth(monthlyBreakdown);
      setShowMonthlyModal(true);
    } catch (error) {
      console.error('Error fetching monthly breakdown:', error);
    }
  };

  // Function to generate and download report
  const handleGenerateReport = async () => {
    if (!reportsData || !reportsData.summary || !reportsData.monthlyData) {
      alert('No report data available. Please ensure you have transactions and data to generate a report.');
      return;
    }

    setIsGeneratingReport(true);
    try {
      const reportData = {
        user: user?.email,
        generatedAt: new Date().toISOString(),
        summary: reportsData.summary,
        monthlyData: reportsData.monthlyData,
        format: exportFormat
      };

      if (exportFormat === 'PDF') {
        // Generate PDF report
        console.log('🔄 [Reports Page] Generating PDF report...');
        const response = await fetch('/api/reports/generate-pdf', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          credentials: 'include',
          body: JSON.stringify(reportData)
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
          console.error('❌ [Reports Page] PDF generation failed:', errorData);
          
          // Check if it's a subscription required error
          if (errorData.requiresSubscription) {
            alert('An active subscription is required to export reports. Please subscribe to access this feature.');
            router.push('/protected/subscriptions');
            setShowExportModal(false);
            return;
          }
          
          throw new Error(errorData.error || `Failed to generate PDF: ${response.status} ${response.statusText}`);
        }

        const blob = await response.blob();
        if (!blob || blob.size === 0) {
          throw new Error('PDF generation returned empty file');
        }

        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `tax-report-${new Date().toISOString().split('T')[0]}.pdf`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);

        console.log('✅ [Reports Page] PDF generated and downloaded successfully');
      } else {
        // Generate CSV report
        console.log('🔄 [Reports Page] Generating CSV report...');
        const csvContent = generateCSVReport(reportData);
        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `tax-report-${new Date().toISOString().split('T')[0]}.csv`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);

        console.log('✅ [Reports Page] CSV generated and downloaded successfully');
      }

      setShowExportModal(false);
    } catch (error) {
      console.error('❌ [Reports Page] Error generating report:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to generate report. Please try again.';
      alert(`Error: ${errorMessage}`);
    } finally {
      setIsGeneratingReport(false);
    }
  };

  // Function to generate CSV content
  const generateCSVReport = (data: any): string => {
    const headers = ['Month', 'Tax Savings', 'Transaction Count', 'Year to Date Total', 'Estimated Refund'];
    const rows = data.monthlyData.map((month: MonthlyData) => [
      month.monthName,
      month.total.toFixed(2),
      month.count,
      data.summary.yearToDateTotal.toFixed(2),
      data.summary.estimatedRefund.toFixed(2)
    ]);

    return [headers, ...rows].map(row => row.join(',')).join('\n');
  };

  // Show loading state while auth is loading or data is fetching
  if (authLoading || isLoading) {
    return (
      <div className="p-4 sm:p-6 bg-background min-h-screen">
        <PageHeaderSkeleton />
        <ReportsChartSkeleton />
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="bg-card p-6 rounded-lg border animate-pulse">
            <div className="h-4 w-24 mb-3 bg-muted rounded"></div>
            <div className="h-8 w-32 mb-2 bg-muted rounded"></div>
            <div className="h-3 w-20 bg-muted rounded"></div>
          </div>
          <div className="bg-card p-6 rounded-lg border animate-pulse">
            <div className="h-4 w-24 mb-3 bg-muted rounded"></div>
            <div className="h-8 w-32 mb-2 bg-muted rounded"></div>
            <div className="h-3 w-20 bg-muted rounded"></div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 sm:p-6 bg-background min-h-screen">
        <div className="text-center">
          <AlertCircle className="w-16 h-16 text-destructive mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-foreground mb-2">Error Loading Reports</h2>
          <p className="text-muted-foreground mb-4">
            {error instanceof Error ? error.message : 'Failed to load reports data'}
          </p>
          <Button
            onClick={() => refetch()}
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Try Again
          </Button>
        </div>
      </div>
    );
  }

  if (!reportsData || !metrics) {
    return (
      <div className="p-4 sm:p-6 bg-background min-h-screen">
        <div className="text-center text-muted-foreground">
          <AlertCircle className="w-16 h-16 text-muted mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-foreground mb-2">No Reports Data</h2>
          <p className="text-muted-foreground mb-4">
            No reports data is available. This could be because:
          </p>
          <ul className="text-muted-foreground text-left max-w-md mx-auto mb-4">
            <li>• You haven't imported any transactions yet</li>
            <li>• Your transactions haven't been analyzed for deductions</li>
            <li>• There was an issue loading your data</li>
          </ul>
          <Button
            onClick={() => refetch()}
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>
    );
  }

  const { monthlyData, summary } = reportsData;
  const { dataMax, bestMonth, worstMonth, trend, projectedAnnual, monthOverMonthChange, isPositiveChange } = metrics;

  // Calculate dynamic Y-axis scaling
  const maxAmount = dataMax > 0 ? Math.ceil(dataMax * 1.2) : 100;
  const hasData = monthlyData.some(m => m.total > 0);
  const canExport = reportsData && reportsData.summary && reportsData.monthlyData && reportsData.monthlyData.length > 0;

  // Format Y-axis labels properly
  const yAxisLabels = [
    maxAmount,
    Math.round(maxAmount * 0.75),
    Math.round(maxAmount * 0.5),
    Math.round(maxAmount * 0.25),
    0
  ];

  return (
    <div className="p-4 sm:p-6 bg-background min-h-screen">
      {/* Header */}
      <div className="mb-4 sm:mb-6">
        <div className="mb-3">
          <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-foreground mb-0.5">Tax Reports & Analytics</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">Comprehensive tax deduction analysis and savings insights</p>
        </div>
        {/* Action Buttons */}
        <div className="flex flex-wrap gap-2 sm:gap-3">
          <Button
            onClick={() => refetch()}
            variant="outline"
            size="sm"
            className="h-10 px-3 sm:px-4 border-2 border-gray-300 dark:border-gray-500 bg-white dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 hover:border-primary/60 dark:hover:border-primary/60 text-gray-700 dark:text-gray-200 transition-all duration-200 no-tap-highlight group"
            title="Refresh reports data"
          >
            <RefreshCw className="w-4 h-4 group-hover:text-primary transition-colors" />
            <span className="hidden sm:inline ml-2 text-sm font-medium">Refresh</span>
          </Button>
          <OtherReportsDropdown disabled={isGeneratingReport} />
          <Button
            size="sm"
            className="h-10 px-3 sm:px-4 bg-gradient-to-r from-emerald-400 to-green-500 dark:from-emerald-500 dark:to-green-600 hover:from-emerald-500 hover:to-green-600 dark:hover:from-emerald-400 dark:hover:to-green-500 text-white font-medium shadow-md shadow-green-500/20 dark:shadow-green-500/30 hover:shadow-lg hover:shadow-green-500/30 dark:hover:shadow-green-500/40 transition-all duration-200 no-tap-highlight disabled:opacity-50 disabled:shadow-none"
            onClick={() => setShowExportModal(true)}
            disabled={!canExport || isGeneratingReport}
            title={!canExport ? "No data available to export" : "Export tax deduction report"}
          >
            <FileText className="w-4 h-4" />
            <span className="ml-2 text-sm font-medium">Export</span>
          </Button>
          <Button
            size="sm"
            className="h-10 px-3 sm:px-4 bg-gradient-to-r from-blue-400 to-indigo-500 dark:from-blue-500 dark:to-indigo-600 hover:from-blue-500 hover:to-indigo-600 dark:hover:from-blue-400 dark:hover:to-indigo-500 text-white font-medium shadow-md shadow-blue-500/20 dark:shadow-blue-500/30 hover:shadow-lg hover:shadow-blue-500/30 dark:hover:shadow-blue-500/40 transition-all duration-200 no-tap-highlight"
            onClick={() => router.push('/protected/schedule-c')}
          >
            <Download className="w-4 h-4" />
            <span className="ml-2 text-sm font-medium">Schedule C</span>
          </Button>
        </div>
      </div>

      {/* Summary Cards - Compact 2x2 grid on mobile */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3 mb-4 sm:mb-6">
        {/* Year to Date Total */}
        <Card className="p-3 sm:p-4 bg-gradient-to-br from-blue-500 to-blue-600 dark:from-blue-600 dark:to-blue-700 text-white border-0 shadow-md">
          <div className="flex items-center justify-between mb-1">
            <DollarSign className="w-4 h-4 opacity-90" />
            <span className="text-[10px] sm:text-xs opacity-90">Year to Date</span>
          </div>
          <div className="text-lg sm:text-2xl font-bold">
            ${summary.yearToDateTotal.toFixed(2)}
          </div>
          <div className="text-[10px] sm:text-xs opacity-90">Total tax savings</div>
        </Card>

        {/* Current Month */}
        <Card className="p-3 sm:p-4 bg-gradient-to-br from-green-500 to-green-600 dark:from-green-600 dark:to-green-700 text-white border-0 shadow-md cursor-pointer hover:shadow-lg transition-shadow no-tap-highlight"
          onClick={() => {
            const currentMonth = monthlyData.find(m => m.month === new Date().getMonth());
            if (currentMonth && currentMonth.total > 0) {
              handleMonthClick(currentMonth);
            }
          }}>
          <div className="flex items-center justify-between mb-1">
            <Calendar className="w-4 h-4 opacity-90" />
            <span className="text-[10px] sm:text-xs opacity-90">This Month</span>
          </div>
          <div className="text-lg sm:text-2xl font-bold">
            ${summary.currentMonthTotal.toFixed(2)}
          </div>
          <div className="flex items-center gap-0.5 text-[10px] sm:text-xs opacity-90">
            {isPositiveChange ? (
              <>
                <ArrowUpRight className="w-3 h-3" />
                <span>{Math.abs(monthOverMonthChange).toFixed(1)}%</span>
              </>
            ) : monthOverMonthChange !== 0 ? (
              <>
                <ArrowDownRight className="w-3 h-3" />
                <span>{Math.abs(monthOverMonthChange).toFixed(1)}%</span>
              </>
            ) : (
              <span>No change</span>
            )}
            <span className="hidden sm:inline ml-0.5">vs last month</span>
          </div>
        </Card>

        {/* Average Monthly */}
        <Card className="p-3 sm:p-4 bg-gradient-to-br from-purple-500 to-purple-600 dark:from-purple-600 dark:to-purple-700 text-white border-0 shadow-md">
          <div className="flex items-center justify-between mb-1">
            <TrendingUp className="w-4 h-4 opacity-90" />
            <span className="text-[10px] sm:text-xs opacity-90">Monthly Avg</span>
          </div>
          <div className="text-lg sm:text-2xl font-bold">
            ${summary.avgMonthly.toFixed(2)}
          </div>
          <div className="text-[10px] sm:text-xs opacity-90">
            <span className="sm:hidden">{summary.monthsWithData}mo data</span>
            <span className="hidden sm:inline">Based on {summary.monthsWithData} {summary.monthsWithData === 1 ? 'month' : 'months'}</span>
          </div>
        </Card>

        {/* Projected Annual */}
        <Card className="p-3 sm:p-4 bg-gradient-to-br from-orange-500 to-orange-600 dark:from-orange-600 dark:to-orange-700 text-white border-0 shadow-md">
          <div className="flex items-center justify-between mb-1">
            <Target className="w-4 h-4 opacity-90" />
            <span className="text-[10px] sm:text-xs opacity-90">Projected</span>
          </div>
          <div className="text-lg sm:text-2xl font-bold">
            ${projectedAnnual.toFixed(2)}
          </div>
          <div className="text-[10px] sm:text-xs opacity-90">
            <span className="sm:hidden">Yearly</span>
            <span className="hidden sm:inline">Estimated yearly savings</span>
          </div>
        </Card>
      </div>

      {/* Monthly Tax Savings Chart */}
      <Card className="p-6 bg-card border shadow-sm mb-6">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center mb-6 gap-4">
          <div>
            <h2 className="text-xl font-semibold text-card-foreground mb-1">Monthly Tax Savings Trend</h2>
            <p className="text-sm text-muted-foreground">Click on any bar to see detailed breakdown</p>
          </div>
          <div className="flex items-center gap-4 flex-wrap">
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>Year</span>
              <select
                value={chartYear}
                onChange={(e) => setChartYear(Number(e.target.value))}
                className="h-9 px-3 rounded-md border border-border bg-background text-foreground text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
              >
                {availableYears.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </label>
            {chartYear === currentYear && trend !== 0 && (
              <div className={`text-xs font-medium flex items-center gap-1 ${trend > 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                {trend > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                {Math.abs(trend).toFixed(1)}% trend
              </div>
            )}
          </div>
        </div>

        {!hasData ? (
          <div className="text-center py-16">
            <BarChart3 className="w-20 h-20 text-muted mx-auto mb-4" />
            <p className="text-muted-foreground mb-2 text-lg font-medium">No tax savings data available</p>
            <p className="text-sm text-muted-foreground/70 max-w-md mx-auto">
              Import and analyze your transactions to see your tax savings breakdown by month
            </p>
          </div>
        ) : (
          <>
            {/* Chart Container */}
            <div className="relative w-full">
              {/* Desktop Chart Layout */}
              <div className="hidden md:flex relative" style={{ height: '360px' }}>
                {/* Y-axis labels container - positioned absolutely to align with grid */}
                <div className="flex-shrink-0 w-16 pr-4 relative" style={{ height: '360px' }}>
                  {yAxisLabels.map((label, index) => {
                    // Calculate position: 0% at top (max value), 100% at bottom (0)
                    const position = (index / (yAxisLabels.length - 1)) * 100;
                    return (
                      <div
                        key={index}
                        className="absolute text-right font-medium text-xs text-muted-foreground w-full"
                        style={{
                          top: `${position}%`,
                          transform: 'translateY(-50%)',
                          lineHeight: '1'
                        }}
                      >
                        ${label.toLocaleString()}
                      </div>
                    );
                  })}
                </div>

                {/* Chart area with grid and bars */}
                <div className="flex-1 relative" style={{ height: '360px' }}>
                  {/* Chart plotting area - accounts for month labels at bottom */}
                  <div className="absolute inset-0" style={{ paddingBottom: '36px' }}>
                    {/* Grid lines - positioned to align with Y-axis labels */}
                    <div className="absolute inset-0 pointer-events-none">
                      {yAxisLabels.map((_, index) => {
                        // Calculate position: 0% at top (max), 100% at bottom (0)
                        const position = (index / (yAxisLabels.length - 1)) * 100;
                        return (
                          <div
                            key={index}
                            className="absolute left-0 right-0 border-t border-border/40"
                            style={{
                              top: `${position}%`,
                              transform: 'translateY(-50%)'
                            }}
                          />
                        );
                      })}
                      {/* Bottom border (zero line) - thicker */}
                      <div className="absolute bottom-0 left-0 right-0 border-t-2 border-border" />
                    </div>

                    {/* Bars container - positioned to align with chart area */}
                    <div className="relative h-full flex items-end justify-between gap-1.5 px-2">
                      {monthlyData.map((month, index) => {
                        const barHeight = month.total > 0 ? Math.max((month.total / maxAmount) * 100, 2) : 0;
                        const isCurrentMonth = month.month === new Date().getMonth();
                        const isClickable = month.total > 0;

                        return (
                          <div
                            key={month.month}
                            className="flex-1 flex items-end justify-center h-full group relative"
                            style={{ minWidth: '0' }}
                          >
                            {/* Bar */}
                            {month.total > 0 ? (
                              <div
                                className={`w-full max-w-[44px] mx-auto rounded-t-md transition-all duration-300 relative ${
                                  isCurrentMonth
                                    ? 'bg-gradient-to-t from-blue-600 to-blue-500 dark:from-blue-500 dark:to-blue-400 shadow-lg ring-2 ring-blue-300/50 dark:ring-blue-500/50'
                                    : 'bg-gradient-to-t from-blue-500 to-blue-400 dark:from-blue-600 dark:to-blue-500'
                                } ${isClickable ? 'hover:from-blue-600 hover:to-blue-500 dark:hover:from-blue-500 dark:hover:to-blue-400 hover:shadow-xl hover:ring-2 hover:ring-blue-400/70 dark:hover:ring-blue-400/70 cursor-pointer' : 'cursor-default'}`}
                                style={{
                                  height: `${barHeight}%`,
                                  minHeight: '4px',
                                }}
                                onClick={() => isClickable && handleMonthClick(month)}
                              >
                                {/* Tooltip */}
                                <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-1.5 bg-popover border border-border text-popover-foreground text-xs rounded-lg shadow-xl opacity-0 group-hover:opacity-100 transition-opacity duration-200 whitespace-nowrap pointer-events-none z-20">
                                  <div className="font-semibold">{month.monthName}</div>
                                  <div className="text-primary dark:text-blue-400 font-bold">${month.total.toFixed(2)}</div>
                                  <div className="text-muted-foreground text-[10px] mt-0.5">{month.count} transactions</div>
                                  {/* Arrow */}
                                  <div className="absolute top-full left-1/2 transform -translate-x-1/2 border-4 border-transparent border-t-popover"></div>
                                </div>
                              </div>
                            ) : (
                              <div className="w-full max-w-[44px] mx-auto h-1 bg-transparent" />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Month labels - positioned below chart area */}
                  <div className="absolute bottom-0 left-0 right-0 flex justify-between gap-1.5 px-2" style={{ height: '36px' }}>
                    {monthlyData.map((month) => (
                      <div
                        key={month.month}
                        className="flex-1 flex items-center justify-center"
                        style={{ minWidth: '0' }}
                      >
                        <div
                          className="text-xs text-card-foreground font-medium text-center w-full truncate"
                          title={month.monthName}
                        >
                          {month.monthName.substring(0, 3)}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Value labels on bars (for small values) - positioned relative to bars */}
                  {monthlyData.map((month) => {
                    const barHeight = month.total > 0 ? Math.max((month.total / maxAmount) * 100, 2) : 0;
                    if (month.total > 0 && barHeight < 12) {
                      const barIndex = monthlyData.findIndex(m => m.month === month.month);
                      const barWidth = 100 / monthlyData.length;
                      return (
                        <div
                          key={`label-${month.month}`}
                          className="absolute left-1/2 transform -translate-x-1/2 text-[10px] font-semibold text-card-foreground whitespace-nowrap z-10 pointer-events-none"
                          style={{
                            left: `${(barIndex + 0.5) * barWidth}%`,
                            bottom: `calc(${barHeight}% + 36px)`,
                          }}
                        >
                          ${month.total > 999 ? (month.total / 1000).toFixed(1) + 'k' : month.total.toFixed(0)}
                        </div>
                      );
                    }
                    return null;
                  })}
                </div>
              </div>

              {/* Mobile Chart Layout */}
              <div className="md:hidden">
                {/* Y-axis labels */}
                <div className="flex justify-between text-xs text-muted-foreground mb-2 px-2">
                  <span className="font-medium">${maxAmount.toLocaleString()}</span>
                  <span className="font-medium">$0</span>
                </div>

                {/* Chart area */}
                <div className="relative" style={{ height: '280px' }}>
                  {/* Grid lines */}
                  <div className="absolute inset-0 pointer-events-none">
                    {yAxisLabels.map((_, index) => {
                      const position = (index / (yAxisLabels.length - 1)) * 100;
                      return (
                        <div
                          key={index}
                          className="absolute left-0 right-0 border-t border-border/30"
                          style={{
                            top: `${position}%`,
                            transform: 'translateY(-50%)'
                          }}
                        />
                      );
                    })}
                  </div>

                  {/* Bars */}
                  <div className="relative h-full flex items-end justify-between gap-1 px-1">
                    {monthlyData.map((month) => {
                      const barHeight = month.total > 0 ? Math.max((month.total / maxAmount) * 100, 2) : 0;
                      const isCurrentMonth = month.month === new Date().getMonth();
                      const isClickable = month.total > 0;

                      return (
                        <div
                          key={month.month}
                          className="flex-1 flex flex-col items-center justify-end h-full group relative"
                          style={{ minWidth: '0' }}
                        >
                          {/* Bar */}
                          <div
                            className={`w-full max-w-[32px] mx-auto rounded-t-lg transition-all duration-300 relative ${
                              isCurrentMonth
                                ? 'bg-gradient-to-t from-blue-600 to-blue-500 dark:from-blue-500 dark:to-blue-400 shadow-lg'
                                : 'bg-gradient-to-t from-blue-500 to-blue-400 dark:from-blue-600 dark:to-blue-500'
                            } ${isClickable ? 'hover:from-blue-600 hover:to-blue-500 dark:hover:from-blue-500 dark:hover:to-blue-400 hover:shadow-xl cursor-pointer' : 'opacity-30 cursor-default'}`}
                            style={{
                              height: `${barHeight}%`,
                              minHeight: month.total > 0 ? '4px' : '0px',
                            }}
                            onClick={() => isClickable && handleMonthClick(month)}
                          >
                            {/* Tooltip */}
                            {month.total > 0 && (
                              <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 bg-popover border border-border text-popover-foreground text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 whitespace-nowrap pointer-events-none z-20">
                                <div className="font-semibold">{month.monthName}</div>
                                <div className="text-primary dark:text-blue-400">${month.total.toFixed(2)}</div>
                              </div>
                            )}
                          </div>

                          {/* Month label */}
                          <div className="mt-1.5 text-[10px] text-card-foreground font-medium text-center w-full truncate">
                            {month.monthName.substring(0, 3)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            {/* Chart Insights */}
            {bestMonth.total > 0 && (
              <div className="mt-6 pt-6 border-t border-border grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="flex items-center gap-3 p-3 bg-green-500/10 dark:bg-green-500/20 rounded-lg border border-green-500/20">
                  <div className="p-2 bg-green-500/20 dark:bg-green-500/30 rounded-full">
                    <TrendingUp className="w-4 h-4 text-green-600 dark:text-green-400" />
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Best Month</div>
                    <div className="font-semibold text-card-foreground">{bestMonth.monthName}</div>
                    <div className="text-sm text-green-600 dark:text-green-400 font-medium">${bestMonth.total.toFixed(2)}</div>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-3 bg-primary/10 dark:bg-primary/20 rounded-lg border border-primary/20">
                  <div className="p-2 bg-primary/20 dark:bg-primary/30 rounded-full">
                    <BarChart3 className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Total Transactions</div>
                    <div className="font-semibold text-card-foreground">
                      {monthlyData.reduce((sum, m) => sum + m.count, 0)}
                    </div>
                    <div className="text-sm text-primary font-medium">Deductible items</div>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-3 bg-purple-500/10 dark:bg-purple-500/20 rounded-lg border border-purple-500/20">
                  <div className="p-2 bg-purple-500/20 dark:bg-purple-500/30 rounded-full">
                    <Info className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Estimated Refund</div>
                    <div className="font-semibold text-card-foreground">${summary.estimatedRefund.toFixed(2)}</div>
                    <div className="text-sm text-purple-600 dark:text-purple-400 font-medium">Based on 30% rate</div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </Card>

      {/* Ready to File Section - Compact */}
      <Card className="p-3 sm:p-5 bg-card/50 dark:bg-card border shadow-sm mb-4 sm:mb-6">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm sm:text-lg font-semibold text-card-foreground">Tax Filing Summary</h3>
            <p className="text-xs text-muted-foreground">Your estimated tax situation for {chartYear}</p>
          </div>
          <FileText className="w-5 h-5 text-muted-foreground hidden sm:block" />
        </div>
        {/* 3 cards in a row on all screen sizes */}
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          <div className="p-2 sm:p-3 bg-card dark:bg-card/50 rounded-lg border border-border text-center">
            <div className="text-[10px] sm:text-xs text-muted-foreground mb-0.5">Est. Refund</div>
            <div className="text-sm sm:text-xl font-bold text-green-600 dark:text-green-400">
              ${summary.estimatedRefund.toFixed(0)}
            </div>
          </div>
          <div className="p-2 sm:p-3 bg-card dark:bg-card/50 rounded-lg border border-border text-center">
            <div className="text-[10px] sm:text-xs text-muted-foreground mb-0.5">YTD Savings</div>
            <div className="text-sm sm:text-xl font-bold text-primary">
              ${summary.yearToDateTotal.toFixed(0)}
            </div>
          </div>
          <div className="p-2 sm:p-3 bg-card dark:bg-card/50 rounded-lg border border-border text-center">
            <div className="text-[10px] sm:text-xs text-muted-foreground mb-0.5">Projected</div>
            <div className="text-sm sm:text-xl font-bold text-purple-600 dark:text-purple-400">
              ${projectedAnnual.toFixed(0)}
            </div>
          </div>
        </div>
        <div className="mt-3 pt-3 border-t border-border">
          <div className="flex items-center justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className="text-xs sm:text-sm font-medium text-card-foreground">Ready to file?</div>
              <div className="text-[10px] sm:text-xs text-muted-foreground hidden sm:block">Export reports for tax preparation</div>
            </div>
            <Button
              size="sm"
              onClick={() => setShowExportModal(true)}
              className="bg-primary hover:bg-primary/90 text-primary-foreground h-8 px-3 no-tap-highlight"
              disabled={!canExport}
            >
              <Download className="w-3.5 h-3.5 sm:mr-1.5" />
              <span className="hidden sm:inline">Export</span>
            </Button>
          </div>
        </div>
      </Card>

      {/* Monthly Breakdown Modal */}
      {showMonthlyModal && selectedMonth && (
        <div className="fixed inset-0 bg-black/50 dark:bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="p-6 border-b border-border sticky top-0 bg-card z-10">
              <div className="flex justify-between items-center">
                <h2 className="text-2xl font-bold text-card-foreground">
                  {selectedMonth.monthName} {chartYear} Detailed Breakdown
                </h2>
                <button
                  onClick={() => setShowMonthlyModal(false)}
                  className="text-muted-foreground hover:text-foreground active:text-foreground touch-target p-2 rounded-lg hover:bg-muted transition-colors"
                  aria-label="Close modal"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>
            </div>

            <div className="p-6">
              {/* Summary Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                <div className="text-center p-5 bg-blue-500/10 dark:bg-blue-500/20 rounded-lg border border-blue-500/20">
                  <div className="text-3xl font-bold text-blue-600 dark:text-blue-400 mb-1">
                    ${selectedMonth.total.toFixed(2)}
                  </div>
                  <div className="text-sm text-muted-foreground font-medium">Tax Savings</div>
                </div>
                <div className="text-center p-5 bg-green-500/10 dark:bg-green-500/20 rounded-lg border border-green-500/20">
                  <div className="text-3xl font-bold text-green-600 dark:text-green-400 mb-1">
                    {selectedMonth.transactionCount}
                  </div>
                  <div className="text-sm text-muted-foreground font-medium">Deductible Transactions</div>
                </div>
                <div className="text-center p-5 bg-purple-500/10 dark:bg-purple-500/20 rounded-lg border border-purple-500/20">
                  <div className="text-3xl font-bold text-purple-600 dark:text-purple-400 mb-1">
                    {Object.keys(selectedMonth.categoryBreakdown).length}
                  </div>
                  <div className="text-sm text-muted-foreground font-medium">Categories</div>
                </div>
              </div>

              {/* Category Breakdown */}
              <div className="mb-6">
                <h3 className="text-lg font-semibold text-card-foreground mb-4">Category Breakdown</h3>
                <div className="space-y-2">
                  {Object.entries(selectedMonth.categoryBreakdown)
                    .sort(([,a], [,b]) => b - a)
                    .map(([category, amount]) => (
                      <div key={category} className="flex justify-between items-center p-4 bg-muted/50 dark:bg-muted/30 rounded-lg hover:bg-muted dark:hover:bg-muted/50 transition-colors border border-border/50">
                        <span className="font-medium text-card-foreground">{category.replace(/_/g, ' ')}</span>
                        <span className="text-primary dark:text-blue-400 font-semibold text-lg">${amount.toFixed(2)}</span>
                      </div>
                    ))}
                </div>
              </div>

              {/* Recent Transactions */}
              <div>
                <h3 className="text-lg font-semibold text-card-foreground mb-4">Transactions</h3>
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {selectedMonth.transactions.slice(0, 20).map((transaction) => (
                    <div key={transaction.id} className="flex justify-between items-center p-3 border border-border rounded-lg hover:border-primary/50 hover:bg-primary/5 dark:hover:bg-primary/10 transition-colors">
                      <div className="flex-1">
                        <div className="font-medium text-card-foreground">{transaction.merchant_name || 'Unknown Merchant'}</div>
                        <div className="text-sm text-muted-foreground">{transaction.category?.replace(/_/g, ' ') || 'Uncategorized'}</div>
                        <div className="text-xs text-muted-foreground/70">{new Date(transaction.date).toLocaleDateString()}</div>
                      </div>
                      <div className="text-right ml-4">
                        <div className="font-semibold text-green-600 dark:text-green-400 text-lg">${Math.abs(transaction.amount).toFixed(2)}</div>
                        {transaction.deduction_score && (
                          <div className="text-xs text-muted-foreground">Score: {transaction.deduction_score}%</div>
                        )}
                      </div>
                    </div>
                  ))}
                  {selectedMonth.transactions.length > 20 && (
                    <div className="text-center text-sm text-muted-foreground py-2">
                      Showing 20 of {selectedMonth.transactions.length} transactions
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Export Modal */}
      {showExportModal && (
        <div className="fixed inset-0 bg-black/50 dark:bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-lg max-w-md w-full max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="p-6 border-b border-border sticky top-0 bg-card z-10">
              <div className="flex justify-between items-center">
                <h2 className="text-xl font-bold text-card-foreground">Generate Report</h2>
                <button
                  onClick={() => setShowExportModal(false)}
                  className="text-muted-foreground hover:text-foreground active:text-foreground touch-target p-2 rounded-lg hover:bg-muted transition-colors"
                  aria-label="Close modal"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="p-6">
              {/* Subscription Required Banner */}
              {!subscriptionLoading && !hasAccess && (
                <div className="mb-6 p-4 bg-gradient-to-r from-purple-50 to-blue-50 dark:from-purple-900/20 dark:to-blue-900/20 rounded-lg border border-purple-200 dark:border-purple-800">
                  <div className="flex items-start gap-3">
                    <div className="p-2 bg-purple-100 dark:bg-purple-800/50 rounded-lg">
                      <Lock className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                    </div>
                    <div className="flex-1">
                      <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-1">
                        Subscription Required
                      </h3>
                      <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                        Export reports as PDF or CSV with an active subscription.
                      </p>
                      <Button
                        onClick={() => {
                          setShowExportModal(false);
                          router.push('/protected/subscriptions');
                        }}
                        className="bg-purple-600 hover:bg-purple-700 text-white"
                        size="sm"
                      >
                        <Sparkles className="w-4 h-4 mr-2" />
                        Subscribe Now
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              <div className="mb-6">
                <label className="block text-sm font-medium text-card-foreground mb-3">
                  Export Format
                </label>
                <div className="space-y-3">
                  <label className={`flex items-center p-3 border-2 border-border rounded-lg transition-colors ${hasAccess ? 'cursor-pointer hover:bg-muted/50 dark:hover:bg-muted/30' : 'opacity-50 cursor-not-allowed'}`}>
                    <input
                      type="radio"
                      value="PDF"
                      checked={exportFormat === 'PDF'}
                      onChange={(e) => setExportFormat(e.target.value as 'PDF' | 'CSV')}
                      className="mr-3"
                      disabled={!hasAccess}
                    />
                    <div>
                      <div className="font-medium text-card-foreground">PDF Report</div>
                      <div className="text-xs text-muted-foreground">Formatted document with charts and summaries</div>
                    </div>
                  </label>
                  <label className={`flex items-center p-3 border-2 border-border rounded-lg transition-colors ${hasAccess ? 'cursor-pointer hover:bg-muted/50 dark:hover:bg-muted/30' : 'opacity-50 cursor-not-allowed'}`}>
                    <input
                      type="radio"
                      value="CSV"
                      checked={exportFormat === 'CSV'}
                      onChange={(e) => setExportFormat(e.target.value as 'PDF' | 'CSV')}
                      className="mr-3"
                      disabled={!hasAccess}
                    />
                    <div>
                      <div className="font-medium text-card-foreground">CSV Spreadsheet</div>
                      <div className="text-xs text-muted-foreground">Raw data for Excel or Google Sheets</div>
                    </div>
                  </label>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-3">
                {!subscriptionLoading && !hasAccess ? (
                  <Button
                    disabled
                    className="flex-1 bg-gray-400 text-white cursor-not-allowed"
                  >
                    <Lock className="w-4 h-4 mr-2" />
                    Subscription Required
                  </Button>
                ) : (
                  <Button
                    onClick={handleGenerateReport}
                    disabled={isGeneratingReport || subscriptionLoading}
                    className="flex-1 bg-primary hover:bg-primary/90 text-primary-foreground"
                  >
                    {isGeneratingReport ? (
                      <>
                        <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                        Generating...
                      </>
                    ) : (
                      <>
                        <Download className="w-4 h-4 mr-2" />
                        Generate Report
                      </>
                    )}
                  </Button>
                )}
                <Button
                  onClick={() => setShowExportModal(false)}
                  variant="outline"
                  className="px-6"
                >
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Toast Container */}
      <ToastContainer toasts={toasts} onClose={removeToast} />
    </div>
  );
}