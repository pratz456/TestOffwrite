"use client";

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Download, Home, Calculator, AlertCircle, CheckCircle } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/lib/firebase/auth-context';
import { useToasts } from '@/components/ui/toast';
import { ToastContainer } from '@/components/ui/toast';
import { calc8829, validateHomeOfficeSettings, HomeOfficeSettings } from '@/lib/reports/calc8829';

export default function Form8829Page() {
  const router = useRouter();
  const { user } = useAuth();
  const { toasts, removeToast, showSuccess, showError } = useToasts();
  
  const [selectedYear, setSelectedYear] = useState('2024');
  const [exportFormat, setExportFormat] = useState('PDF');
  const [isExporting, setIsExporting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [homeOfficeSettings, setHomeOfficeSettings] = useState<HomeOfficeSettings | null>(null);
  const [calculation, setCalculation] = useState<any>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  useEffect(() => {
    if (user) {
      loadHomeOfficeSettings();
    }
  }, [user]);

  const loadHomeOfficeSettings = async () => {
    try {
      setIsLoading(true);
      const response = await fetch('/api/settings/home-office');
      
      if (response.ok) {
        const { data } = await response.json();
        setHomeOfficeSettings(data);
        
        if (data) {
          const calc = calc8829(data);
          setCalculation(calc);
          
          const errors = validateHomeOfficeSettings(data);
          setValidationErrors(errors);
        }
      } else if (response.status === 404) {
        // No settings found - this is expected for new users
        setHomeOfficeSettings(null);
        setValidationErrors(['Home office settings not configured']);
      }
    } catch (error) {
      console.error('Error loading home office settings:', error);
      showError('Load Failed', 'Failed to load home office settings');
    } finally {
      setIsLoading(false);
    }
  };

  const handleBack = () => {
    router.push('/protected/reports');
  };

  const handleExport = async () => {
    if (!homeOfficeSettings) {
      showError('Missing Data', 'Please configure your home office settings first');
      return;
    }

    if (validationErrors.length > 0) {
      showError('Validation Error', 'Please fix the validation errors before exporting');
      return;
    }

    setIsExporting(true);
    
    try {
      const response = await fetch('/api/reports/export', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ type: 'form8829' }),
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
      a.download = `form8829_${today}.pdf`;
      
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      showSuccess('Export Successful', 'Form 8829 has been generated and downloaded successfully');

    } catch (error) {
      console.error('Export error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to export data';
      showError('Export Failed', errorMessage);
    } finally {
      setIsExporting(false);
    }
  };

  const handleSetupSettings = () => {
    router.push('/protected/tax-forms-setup?tab=homeOffice');
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
          <h1 className="text-3xl font-bold text-gray-900">Form 8829 Export</h1>
          <p className="text-gray-600">Export your home office expenses for tax filing</p>
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
            disabled={isExporting || !homeOfficeSettings || validationErrors.length > 0}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white"
          >
            <Download className="w-4 h-4 mr-2" />
            {isExporting ? 'Generating...' : `Export ${selectedYear} Form 8829`}
          </Button>
        </Card>

        {/* Form 8829 Preview */}
        <Card className="p-6">
          <h2 className="text-xl font-semibold mb-4">Form 8829 Preview - Tax Year {selectedYear}</h2>
          
          {!homeOfficeSettings ? (
            <div className="text-center py-12">
              <Home className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">Home Office Settings Not Configured</h3>
              <p className="text-gray-600 mb-4">
                You need to set up your home office information before generating Form 8829.
              </p>
              <Button onClick={handleSetupSettings} className="bg-blue-600 hover:bg-blue-700 text-white">
                <Home className="w-4 h-4 mr-2" />
                Configure Home Office Settings
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
                <Home className="w-4 h-4 mr-2" />
                Fix Configuration
              </Button>
            </div>
          ) : calculation ? (
            <>
              {/* Summary Cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <div className="text-center p-4 bg-green-50 rounded-lg">
                  <div className="text-2xl font-bold text-green-600">
                    {calculation.businessUsePercentage.toFixed(1)}%
                  </div>
                  <div className="text-sm text-gray-600">Business Use</div>
                </div>
                <div className="text-center p-4 bg-blue-50 rounded-lg">
                  <div className="text-2xl font-bold text-blue-600">
                    ${calculation.totalAllocatedExpenses.toFixed(0)}
                  </div>
                  <div className="text-sm text-gray-600">Allocated Expenses</div>
                </div>
                <div className="text-center p-4 bg-purple-50 rounded-lg">
                  <div className="text-2xl font-bold text-purple-600">
                    ${calculation.totalAllowableDeduction.toFixed(0)}
                  </div>
                  <div className="text-sm text-gray-600">Allowable Deduction</div>
                </div>
                <div className="text-center p-4 bg-orange-50 rounded-lg">
                  <div className="text-2xl font-bold text-orange-600">
                    ${calculation.carryoverToNextYear.toFixed(0)}
                  </div>
                  <div className="text-sm text-gray-600">Carryover</div>
                </div>
              </div>

              {/* Home Office Details */}
              <div className="space-y-4">
                <h3 className="text-lg font-medium text-gray-900">Home Office Information</h3>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Total Home Square Footage:</span>
                    <span className="font-medium">{homeOfficeSettings.totalHomeSqFt.toLocaleString()} sq ft</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Office Square Footage:</span>
                    <span className="font-medium">{homeOfficeSettings.officeSqFt.toLocaleString()} sq ft</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Business Use Percentage:</span>
                    <span className="font-medium">{calculation.businessUsePercentage.toFixed(2)}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Maximum Deduction (2024):</span>
                    <span className="font-medium">$1,500</span>
                  </div>
                </div>
              </div>

              {/* Expense Breakdown */}
              <div className="mt-6">
                <h3 className="text-lg font-medium text-gray-900 mb-4">Expense Allocation</h3>
                <div className="space-y-2">
                  {Object.entries(calculation.allocatedExpenses).map(([key, value]) => {
                    const expenseName = key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
                    return (
                      <div key={key} className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                        <span className="font-medium text-gray-900">{expenseName}</span>
                        <span className="text-blue-600 font-semibold">${(value as number).toFixed(2)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          ) : null}
        </Card>

        {/* IRS Form 8829 Information */}
        <Card className="p-6">
          <h2 className="text-xl font-semibold mb-4">IRS Form 8829 Information</h2>
          <div className="text-center py-8">
            <Calculator className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">Form 8829 - Expenses for Business Use of Your Home</h3>
            <p className="text-gray-600 mb-4">
              This form calculates the deductible portion of your home office expenses.
            </p>
            <div className="text-sm text-gray-500 space-y-1">
              <p>• Maximum deduction for 2024: $1,500</p>
              <p>• Business use percentage calculated from square footage</p>
              <p>• Shared expenses allocated based on business use</p>
              <p>• Direct office expenses are 100% deductible</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Toast Container */}
      <ToastContainer toasts={toasts} onClose={removeToast} />
    </div>
  );
}
