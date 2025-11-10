"use client";

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Download, User, AlertCircle, CheckCircle } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/lib/firebase/auth-context';
import { useToasts } from '@/components/ui/toast';
import { ToastContainer } from '@/components/ui/toast';
import { calcScheduleSE, validateTaxSummarySettings, TaxSummarySettings } from '@/lib/reports/calcSE';

export default function ScheduleSEPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { toasts, removeToast, showSuccess, showError } = useToasts();

  const [selectedYear, setSelectedYear] = useState('2024');
  const [exportFormat, setExportFormat] = useState('PDF');
  const [isExporting, setIsExporting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [taxSummary, setTaxSummary] = useState<TaxSummarySettings | null>(null);
  const [calculation, setCalculation] = useState<any>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  useEffect(() => {
    if (user) {
      loadTaxSummary();
    }
  }, [user]);

  const loadTaxSummary = async () => {
    try {
      setIsLoading(true);
      const response = await fetch('/api/settings/tax-summary');

      if (response.ok) {
        const { data } = await response.json();
        setTaxSummary(data);

        if (data) {
          const calc = calcScheduleSE(data, (user as any)?.filing_status || 'single');
          setCalculation(calc);

          const errors = validateTaxSummarySettings(data);
          setValidationErrors(errors);
        }
      } else if (response.status === 404) {
        setTaxSummary(null);
        setValidationErrors(['Tax summary settings not configured']);
      }
    } catch (error) {
      console.error('Error loading tax summary:', error);
      showError('Load Failed', 'Failed to load tax summary settings');
    } finally {
      setIsLoading(false);
    }
  };

  const handleBack = () => {
    router.push('/protected/reports');
  };

  const handleExport = async () => {
    if (!taxSummary) {
      showError('Missing Data', 'Please configure your tax summary settings first');
      return;
    }

    if (validationErrors.length > 0) {
      showError('Validation Error', 'Please fix the validation errors before exporting');
      return;
    }

    setIsExporting(true);

    try {
      // Get auth token for authentication
      const { auth } = await import('@/lib/firebase/client');
      const currentUser = auth.currentUser;
      if (!currentUser) {
        showError('Authentication Error', 'Please log in to export reports');
        return;
      }
      const token = await currentUser.getIdToken();

      const response = await fetch('/api/reports/export', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        credentials: 'include',
        body: JSON.stringify({ type: 'scheduleSE' }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to generate report');
      }

      // Handle PDF download
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;

      const today = new Date().toISOString().split('T')[0];
      a.download = `scheduleSE_${today}.pdf`;

      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      showSuccess('Export Successful', 'Schedule SE has been generated and downloaded successfully');

    } catch (error) {
      console.error('Export error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to export data';
      showError('Export Failed', errorMessage);
    } finally {
      setIsExporting(false);
    }
  };

  const handleSetupSettings = () => {
    router.push('/protected/tax-forms-setup?tab=taxSummary');
  };

  if (isLoading) {
    return (
      <div className="p-6 bg-gray-50 min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-2 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <button
          onClick={handleBack}
          className="p-2 hover:bg-gray-200 rounded-lg transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-gray-600" />
        </button>
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Schedule SE Export</h1>
          <p className="text-gray-600">Export your self-employment tax calculations for tax filing</p>
        </div>
      </div>

      <div className="max-w-4xl mx-auto space-y-6">
        {/* Export Options */}
        <Card className="p-6">
          <h2 className="text-xl font-semibold mb-4">Export Options</h2>
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Tax Year</label>
              <Select value={selectedYear} onValueChange={setSelectedYear}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="2024">2024</SelectItem>
                  <SelectItem value="2023">2023</SelectItem>
                  <SelectItem value="2022">2022</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Export Format</label>
              <Select value={exportFormat} onValueChange={setExportFormat}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PDF">PDF Document</SelectItem>
                  <SelectItem value="CSV">CSV Spreadsheet</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button
            onClick={handleExport}
            disabled={isExporting || !taxSummary || validationErrors.length > 0}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white"
          >
            <Download className="w-4 h-4 mr-2" />
            {isExporting ? 'Generating...' : `Export ${selectedYear} Schedule SE`}
          </Button>
        </Card>

        {/* Schedule SE Preview */}
        <Card className="p-6">
          <h2 className="text-xl font-semibold mb-4">Schedule SE Preview - Tax Year {selectedYear}</h2>

          {!taxSummary ? (
            <div className="text-center py-12">
              <User className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">Tax Summary Settings Not Configured</h3>
              <p className="text-gray-600 mb-4">
                You need to set up your tax summary information before generating Schedule SE.
              </p>
              <Button onClick={handleSetupSettings} className="bg-blue-600 hover:bg-blue-700 text-white">
                <User className="w-4 h-4 mr-2" />
                Configure Tax Summary
              </Button>
            </div>
          ) : validationErrors.length > 0 ? (
            <div className="text-center py-12">
              <AlertCircle className="w-16 h-16 text-red-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">Configuration Issues</h3>
              <div className="text-left max-w-md mx-auto mb-4">
                <ul className="text-sm text-red-600 space-y-1">
                  {validationErrors.map((error, index) => (
                    <li key={index}>• {error}</li>
                  ))}
                </ul>
              </div>
              <Button onClick={handleSetupSettings} className="bg-blue-600 hover:bg-blue-700 text-white">
                <User className="w-4 h-4 mr-2" />
                Fix Configuration
              </Button>
            </div>
          ) : calculation ? (
            <>
              {/* Summary Cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <div className="text-center p-4 bg-green-50 rounded-lg">
                  <div className="text-2xl font-bold text-green-600">
                    ${calculation.netEarnings.toFixed(0)}
                  </div>
                  <div className="text-sm text-gray-600">Net Earnings</div>
                </div>
                <div className="text-center p-4 bg-blue-50 rounded-lg">
                  <div className="text-2xl font-bold text-blue-600">
                    ${calculation.seBase.toFixed(0)}
                  </div>
                  <div className="text-sm text-gray-600">SE Base (92.35%)</div>
                </div>
                <div className="text-center p-4 bg-purple-50 rounded-lg">
                  <div className="text-2xl font-bold text-purple-600">
                    ${calculation.totalSETax.toFixed(0)}
                  </div>
                  <div className="text-sm text-gray-600">Total SE Tax</div>
                </div>
                <div className="text-center p-4 bg-orange-50 rounded-lg">
                  <div className="text-2xl font-bold text-orange-600">
                    ${calculation.halfSEDeduction.toFixed(0)}
                  </div>
                  <div className="text-sm text-gray-600">Half SE Deduction</div>
                </div>
              </div>

              {/* Tax Breakdown */}
              <div className="space-y-4">
                <h3 className="text-lg font-medium text-gray-900">Tax Breakdown</h3>
                <div className="space-y-2">
                  <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                    <span className="font-medium text-gray-900">Social Security Tax (12.4%):</span>
                    <span className="text-blue-600 font-semibold">${calculation.socialSecurityTax.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                    <span className="font-medium text-gray-900">Medicare Tax (2.9%):</span>
                    <span className="text-blue-600 font-semibold">${calculation.medicareTax.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                    <span className="font-medium text-gray-900">Additional Medicare Tax (0.9%):</span>
                    <span className="text-blue-600 font-semibold">${calculation.additionalMedicareTax.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between items-center p-3 bg-green-50 rounded-lg border border-green-200">
                    <span className="font-medium text-gray-900">Total SE Tax:</span>
                    <span className="text-green-600 font-bold text-lg">${calculation.totalSETax.toFixed(2)}</span>
                  </div>
                </div>
              </div>

              {/* Tax Summary Details */}
              <div className="mt-6">
                <h3 className="text-lg font-medium text-gray-900 mb-4">Tax Summary Details</h3>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Schedule C Net Profit:</span>
                    <span className="font-medium">${calculation.netProfitFromScheduleC.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Adjustments:</span>
                    <span className="font-medium">${calculation.adjustments.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Filing Status:</span>
                    <span className="font-medium">{(user as any)?.filing_status || 'single'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Half SE Deduction:</span>
                    <span className="font-medium text-green-600">${calculation.halfSEDeduction.toFixed(2)}</span>
                  </div>
                </div>
              </div>
            </>
          ) : null}
        </Card>

        {/* IRS Schedule SE Information */}
        <Card className="p-6">
          <h2 className="text-xl font-semibold mb-4">IRS Schedule SE Information</h2>
          <div className="text-center py-8">
            <User className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">Schedule SE - Self-Employment Tax</h3>
            <p className="text-gray-600 mb-4">
              This form calculates self-employment tax on your business income.
            </p>
            <div className="text-sm text-gray-500 space-y-1">
              <p>• Social Security tax: 12.4% up to $168,600 (2024)</p>
              <p>• Medicare tax: 2.9% on all earnings</p>
              <p>• Additional Medicare tax: 0.9% on high earners</p>
              <p>• Half of SE tax is deductible on Schedule 1</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Toast Container */}
      <ToastContainer toasts={toasts} onClose={removeToast} />
    </div>
  );
}
