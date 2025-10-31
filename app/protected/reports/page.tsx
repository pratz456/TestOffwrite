"use client";

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileText, TrendingUp, Calendar, BarChart3, AlertCircle, Download, Eye, X, Filter, ChevronDown } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/firebase/auth-context';
import { useMonthlyDeductions } from '@/lib/react-query/hooks';
import { ReportsChartSkeleton, PageHeaderSkeleton } from '@/components/ui/skeleton';
import { OtherReportsDropdown } from './components/OtherReportsDropdown';
import { ToastContainer, useToasts } from '@/components/ui/toast';

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
  const { toasts, removeToast } = useToasts();

  // Use React Query for data fetching with caching
  const { 
    data: reportsResult, 
    isLoading, 
    error, 
    refetch 
  } = useMonthlyDeductions(user?.id || '');

  const reportsData = reportsResult?.data as ReportsData | undefined;

  // Function to handle monthly breakdown
  const handleMonthClick = async (monthData: MonthlyData) => {
    try {
      // Fetch detailed transactions for the selected month
      const response = await fetch(`/api/transactions?month=${monthData.month}&year=2024`);
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
    setIsGeneratingReport(true);
    try {
      const reportData = {
        user: user?.email,
        generatedAt: new Date().toISOString(),
        summary: reportsData?.summary,
        monthlyData: reportsData?.monthlyData,
        format: exportFormat
      };

      if (exportFormat === 'PDF') {
        // Generate PDF report
        const response = await fetch('/api/reports/generate-pdf', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(reportData)
        });
        
        if (response.ok) {
          const blob = await response.blob();
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `tax-report-${new Date().toISOString().split('T')[0]}.pdf`;
          document.body.appendChild(a);
          a.click();
          window.URL.revokeObjectURL(url);
          document.body.removeChild(a);
        }
      } else {
        // Generate CSV report
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
      }
      
      setShowExportModal(false);
    } catch (error) {
      console.error('Error generating report:', error);
      alert('Failed to generate report. Please try again.');
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
      <div className="p-6 bg-gray-50 min-h-screen">
        <PageHeaderSkeleton />
        <ReportsChartSkeleton />
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="bg-white p-6 rounded-lg border animate-pulse">
            <div className="h-4 w-24 mb-3 bg-gray-200 rounded"></div>
            <div className="h-8 w-32 mb-2 bg-gray-200 rounded"></div>
            <div className="h-3 w-20 bg-gray-200 rounded"></div>
          </div>
          <div className="bg-white p-6 rounded-lg border animate-pulse">
            <div className="h-4 w-24 mb-3 bg-gray-200 rounded"></div>
            <div className="h-8 w-32 mb-2 bg-gray-200 rounded"></div>
            <div className="h-3 w-20 bg-gray-200 rounded"></div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 bg-gray-50 min-h-screen">
        <div className="text-center">
          <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Error Loading Reports</h2>
          <p className="text-gray-600 mb-4">
            {error instanceof Error ? error.message : 'Failed to load reports data'}
          </p>
          <Button 
            onClick={() => refetch()}
            className="bg-blue-600 hover:bg-blue-700 text-white"
          >
            Try Again
          </Button>
        </div>
      </div>
    );
  }

  if (!reportsData) {
    return (
      <div className="p-6 bg-gray-50 min-h-screen">
        <div className="text-center text-gray-500">
          <AlertCircle className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">No Reports Data</h2>
          <p className="text-gray-600 mb-4">
            No reports data is available. This could be because:
          </p>
          <ul className="text-gray-600 text-left max-w-md mx-auto mb-4">
            <li>• You haven't imported any transactions yet</li>
            <li>• Your transactions haven't been analyzed for deductions</li>
            <li>• There was an issue loading your data</li>
          </ul>
          <Button 
            onClick={() => refetch()}
            className="bg-blue-600 hover:bg-blue-700 text-white"
          >
            Refresh
          </Button>
        </div>
      </div>
    );
  }

  const { monthlyData, summary } = reportsData;
  
  // Calculate dynamic Y-axis scaling based on actual data
  const dataValues = monthlyData.map(m => m.total).filter(val => val > 0);
  const dataMax = Math.max(...dataValues, 0);
  const maxAmount = dataMax > 0 ? Math.ceil(dataMax * 1.2) : 100; // Add 20% padding above highest value

  // Check if we have any meaningful data
  const hasData = dataValues.length > 0 && dataMax > 0;

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      {/* Header */}
      <div className="flex justify-between items-start mb-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 mb-1">Reports</h1>
          <p className="text-gray-600">Your tax deduction analysis and savings summary</p>
        </div>
        <div className="flex gap-2">
          <OtherReportsDropdown disabled={isGeneratingReport} />
          <Button 
            className="bg-blue-600 hover:bg-blue-700 text-white"
            onClick={() => router.push('/protected/schedule-c')}
          >
            <Download className="w-4 h-4 mr-2" />
            Export Schedule C
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex space-x-1 mb-6 bg-white rounded-lg p-1 w-fit">
        <button
          onClick={() => setActiveTab('overview')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            activeTab === 'overview'
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Overview
        </button>
      </div>

      {activeTab === 'overview' && (
        <>
          {/* Monthly Tax Savings Chart */}
          <Card className="p-6 bg-white border-0 shadow-sm mb-6">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-semibold text-gray-900">Monthly Estimated Tax Savings</h2>
              <span className="text-sm text-gray-500">2024</span>
            </div>

            {!hasData ? (
              <div className="text-center py-12">
                <BarChart3 className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-500 mb-2">No tax savings data available</p>
                <p className="text-sm text-gray-400">
                  Import and analyze your transactions to see your tax savings
                </p>
              </div>
            ) : (
              <>
                {/* Chart */}
                <div className="relative mb-4 ml-16" style={{ height: '256px' }}>
                  {/* Y-axis labels */}
                  <div className="absolute left-0 top-0 h-full flex flex-col justify-between text-xs text-gray-400 -ml-16 w-14 text-right">
                    <span>${maxAmount.toFixed(0)}</span>
                    <span>${(maxAmount * 0.75).toFixed(0)}</span>
                    <span>${(maxAmount * 0.5).toFixed(0)}</span>
                    <span>${(maxAmount * 0.25).toFixed(0)}</span>
                    <span>$0</span>
                  </div>

                  {/* Chart bars */}
                  <div className="relative px-4" style={{ height: '256px' }}>
                    <div className="flex items-end justify-between h-full">
                      {monthlyData.map((month, index) => {
                        const barHeightPx = month.total > 0 ? Math.max((month.total / maxAmount) * 256, 8) : 0;
                        
                        return (
                          <div key={month.month} className="flex flex-col items-center" style={{ width: '8.33%' }}>
                            {/* Bar */}
                            <div 
                              className="w-full bg-blue-500 hover:bg-blue-600 transition-all duration-300 cursor-pointer rounded-t-sm mb-2 relative group"
                              style={{
                                height: `${barHeightPx}px`,
                                maxWidth: '32px'
                              }}
                              onClick={() => handleMonthClick(month)}
                            >
                              {/* Tooltip */}
                              {month.total > 0 && (
                                <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 bg-gray-900 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 whitespace-nowrap pointer-events-none z-10">
                                  ${month.total.toFixed(2)}
                                </div>
                              )}
                            </div>
                            
                            {/* Month label */}
                            <span className="text-xs text-gray-500 mt-1">{month.monthName}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Chart link */}
                <div className="text-center">
                  <button 
                    className="text-blue-600 hover:text-blue-700 text-sm font-medium"
                    onClick={() => {
                      // Show instruction for chart interaction
                      alert('Click on any bar in the chart to view detailed breakdown for that month');
                    }}
                  >
                    Tap bars to view detailed monthly tax savings breakdown
                  </button>
                </div>
              </>
            )}
          </Card>

          {/* Summary Cards */}
          <div className="grid grid-cols-2 gap-4 mb-6">
            {/* This Month Card */}
            <Card 
              className="p-6 bg-white border-0 shadow-sm cursor-pointer hover:shadow-md transition-shadow"
              onClick={() => {
                const currentMonth = monthlyData.find(m => m.month === new Date().getMonth());
                if (currentMonth) {
                  handleMonthClick(currentMonth);
                }
              }}
            >
              <div className="flex items-center gap-3 mb-3">
                <Calendar className="w-5 h-5 text-gray-600" />
                <h3 className="text-sm font-medium text-gray-700">This Month</h3>
              </div>
              <div className="text-2xl font-bold text-gray-900 mb-1">
                ${summary.currentMonthTotal.toFixed(2)}
              </div>
              <div className="text-sm text-green-600 font-medium">
                +{summary.monthOverMonthChange.toFixed(0)}% vs last month
              </div>
            </Card>

            {/* Avg Monthly Card */}
            <Card 
              className="p-6 bg-white border-0 shadow-sm cursor-pointer hover:shadow-md transition-shadow"
              onClick={() => {
                console.log('Average monthly tax savings card clicked');
                // Could show monthly averages breakdown
              }}
            >
              <div className="flex items-center gap-3 mb-3">
                <TrendingUp className="w-5 h-5 text-gray-600" />
                <h3 className="text-sm font-medium text-gray-700">Avg Monthly Tax Savings</h3>
              </div>
              <div className="text-2xl font-bold text-gray-900 mb-1">
                ${summary.avgMonthly.toFixed(2)}
              </div>
              <div className="text-sm text-gray-500">
                Based on {summary.monthsWithData} months
              </div>
            </Card>
          </div>

          {/* Ready to File Section */}
          <Card 
            className="p-6 bg-white border-0 shadow-sm mb-6 cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => {
              console.log('Ready to file section clicked');
              // Could expand to show more filing details
            }}
          >
            <h3 className="text-xl font-semibold text-gray-900 mb-4">Ready to File?</h3>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-gray-700">Estimated Federal Refund</span>
                <span className="text-2xl font-bold text-green-600">
                  ${summary.estimatedRefund.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-700">State Tax Owed</span>
                <span className="text-2xl font-bold text-orange-600">
                  $456.00
                </span>
              </div>
              <div className="border-t border-gray-200 pt-3">
                <div className="flex justify-between items-center">
                  <span className="text-gray-700 font-medium">Net Refund</span>
                  <span className="text-2xl font-bold text-green-600">
                    ${(summary.estimatedRefund - 456).toFixed(2)}
                  </span>
                </div>
              </div>
            </div>
          </Card>

        </>
      )}

      {/* Monthly Breakdown Modal */}
      {showMonthlyModal && selectedMonth && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-200">
              <div className="flex justify-between items-center">
                <h2 className="text-2xl font-bold text-gray-900">
                  {selectedMonth.monthName} 2024 Breakdown
                </h2>
                <button
                  onClick={() => setShowMonthlyModal(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>
            </div>
            
            <div className="p-6">
              {/* Summary */}
              <div className="grid grid-cols-3 gap-4 mb-6">
                <div className="text-center p-4 bg-blue-50 rounded-lg">
                  <div className="text-2xl font-bold text-blue-600">
                    ${selectedMonth.total.toFixed(2)}
                  </div>
                  <div className="text-sm text-gray-600">Tax Savings</div>
                </div>
                <div className="text-center p-4 bg-green-50 rounded-lg">
                  <div className="text-2xl font-bold text-green-600">
                    {selectedMonth.transactionCount}
                  </div>
                  <div className="text-sm text-gray-600">Deductible Transactions</div>
                </div>
                <div className="text-center p-4 bg-purple-50 rounded-lg">
                  <div className="text-2xl font-bold text-purple-600">
                    {Object.keys(selectedMonth.categoryBreakdown).length}
                  </div>
                  <div className="text-sm text-gray-600">Categories</div>
                </div>
              </div>

              {/* Category Breakdown */}
              <div className="mb-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Category Breakdown</h3>
                <div className="space-y-3">
                  {Object.entries(selectedMonth.categoryBreakdown)
                    .sort(([,a], [,b]) => b - a)
                    .map(([category, amount]) => (
                      <div key={category} className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                        <span className="font-medium text-gray-900">{category}</span>
                        <span className="text-blue-600 font-semibold">${amount.toFixed(2)}</span>
                      </div>
                    ))}
                </div>
              </div>

              {/* Recent Transactions */}
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Recent Transactions</h3>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {selectedMonth.transactions.slice(0, 10).map((transaction) => (
                    <div key={transaction.id} className="flex justify-between items-center p-3 border border-gray-200 rounded-lg">
                      <div>
                        <div className="font-medium text-gray-900">{transaction.merchant_name}</div>
                        <div className="text-sm text-gray-500">{transaction.category}</div>
                        <div className="text-xs text-gray-400">{new Date(transaction.date).toLocaleDateString()}</div>
                      </div>
                      <div className="text-right">
                        <div className="font-semibold text-green-600">${Math.abs(transaction.amount).toFixed(2)}</div>
                        {transaction.deduction_score && (
                          <div className="text-xs text-gray-500">Score: {transaction.deduction_score}%</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Export Modal */}
      {showExportModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-md w-full">
            <div className="p-6 border-b border-gray-200">
              <div className="flex justify-between items-center">
                <h2 className="text-xl font-bold text-gray-900">Generate Report</h2>
                <button
                  onClick={() => setShowExportModal(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            
            <div className="p-6">
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Export Format
                </label>
                <div className="space-y-2">
                  <label className="flex items-center">
                    <input
                      type="radio"
                      value="PDF"
                      checked={exportFormat === 'PDF'}
                      onChange={(e) => setExportFormat(e.target.value as 'PDF' | 'CSV')}
                      className="mr-2"
                    />
                    <span>PDF Report</span>
                  </label>
                  <label className="flex items-center">
                    <input
                      type="radio"
                      value="CSV"
                      checked={exportFormat === 'CSV'}
                      onChange={(e) => setExportFormat(e.target.value as 'PDF' | 'CSV')}
                      className="mr-2"
                    />
                    <span>CSV Spreadsheet</span>
                  </label>
                </div>
              </div>

              <div className="flex gap-3">
                <Button
                  onClick={handleGenerateReport}
                  disabled={isGeneratingReport}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
                >
                  {isGeneratingReport ? 'Generating...' : 'Generate Report'}
                </Button>
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
