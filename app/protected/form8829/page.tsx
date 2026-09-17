"use client";

import { SUPPORTED_TAX_YEARS } from '@/lib/tax-rules/federal-year-rules';
import { PremiumFeatureGate } from '@/components/premium-feature-gate';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Download, Home, Calculator, AlertCircle, CheckCircle } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/lib/firebase/auth-context';
import { useToasts } from '@/components/ui/toast';
import { ToastContainer } from '@/components/ui/toast';
import { makeAuthenticatedRequest } from '@/lib/firebase/api-client';
import { SIMPLIFIED_MAX_SQFT, type HomeOfficeSettings, type SimplifiedHomeOfficeCalculation } from '@/lib/reports/calc8829';

interface HomeOfficeWorksheetResponse {
  taxYear: number;
  settings: HomeOfficeSettings | null;
  reviewReasons: string[];
  worksheet: SimplifiedHomeOfficeCalculation | null;
  deduction: number;
  scheduleC: { grossReceipts: number; confirmedExpenses: number; profitBeforeAssets: number; deMinimisExpense: number; depreciationDeduction: number; tentativeProfit: number; netProfit: number };
  warnings: string[];
}
type WorksheetState =
  | { status: 'loading' }
  | { status: 'ready'; data: HomeOfficeWorksheetResponse }
  | { status: 'review'; code: string; message: string; reasons: string[]; settings: HomeOfficeSettings | null }
  | { status: 'error'; message: string };

const money = (value: number) => value.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function Form8829Page() {
  const router = useRouter();
  const { user } = useAuth();
  const { toasts, removeToast, showSuccess, showError } = useToasts();

  const [selectedYear, setSelectedYear] = useState(String(SUPPORTED_TAX_YEARS[SUPPORTED_TAX_YEARS.length - 1]));
  const [exportFormat, setExportFormat] = useState('PDF');
  const [isExporting, setIsExporting] = useState(false);
  const [state, setState] = useState<WorksheetState>({ status: 'loading' });
  const requestId = useRef(0);

  const loadWorksheet = useCallback(async () => {
    const current = ++requestId.current;
    setState({ status: 'loading' });
    try {
      const response = await makeAuthenticatedRequest(`/api/tax/home-office?year=${selectedYear}`);
      const body = await response.json().catch(() => ({}));
      if (current !== requestId.current) return;
      if (response.status === 422 && typeof body.code === 'string') {
        setState({ status: 'review', code: body.code, message: body.error || 'Review the saved records before calculating.', reasons: Array.isArray(body.reviewReasons) ? body.reviewReasons : [], settings: body.settings ?? null });
        return;
      }
      if (!response.ok) throw new Error(body.error || 'The home office worksheet could not be loaded.');
      setState({ status: 'ready', data: body as HomeOfficeWorksheetResponse });
    } catch (error) {
      if (current !== requestId.current) return;
      setState({ status: 'error', message: error instanceof Error ? error.message : 'The home office worksheet could not be loaded.' });
    }
  }, [selectedYear]);

  useEffect(() => {
    if (user) void loadWorksheet();
    return () => { requestId.current += 1; };
  }, [user, loadWorksheet]);

  const handleBack = () => { router.push('/protected/reports'); };
  const handleSetupSettings = () => { router.push('/protected/settings?tab=tax'); };
  const worksheet = state.status === 'ready' ? state.data.worksheet : null;
  const canExport = state.status === 'ready' && worksheet !== null;

  const handleExport = async () => {
    if (!canExport) {
      showError('Review needed', 'Complete the home office facts in Settings before exporting the worksheet.');
      return;
    }
    setIsExporting(true);
    try {
      const response = await makeAuthenticatedRequest('/api/reports/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ type: 'form8829', year: Number(selectedYear) }),
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to generate the worksheet');
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const today = new Date().toISOString().split('T')[0];
      a.download = `home_office_simplified_${selectedYear}_${today}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      showSuccess('Export Successful', 'The home office planning worksheet has been downloaded');
    } catch (error) {
      console.error('Export error:', error);
      showError('Export Failed', error instanceof Error ? error.message : 'Failed to export data');
    } finally {
      setIsExporting(false);
    }
  };

  if (state.status === 'loading') {
    return (
      <div className="p-6 bg-gray-50 min-h-screen">
        <div className="text-center" role="status">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-2 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  const settings = state.status === 'ready' ? state.data.settings : state.status === 'review' ? state.settings : null;

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <div className="flex items-center gap-4 mb-6">
        <button onClick={handleBack} className="p-2 hover:bg-gray-200 rounded-lg transition-colors" aria-label="Back to reports">
          <ArrowLeft className="w-5 h-5 text-gray-600" />
        </button>
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Home Office Worksheet</h1>
          <p className="text-gray-600">Simplified-method planning worksheet for Schedule C line 30 (Rev. Proc. 2013-13). Not Form 8829.</p>
        </div>
      </div>

      <div className="max-w-4xl mx-auto space-y-6">
        <Card className="p-6">
          <h2 className="text-xl font-semibold mb-4">Export Options</h2>
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Tax Year</label>
              <Select value={selectedYear} onValueChange={setSelectedYear}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[...SUPPORTED_TAX_YEARS].reverse().map(year => <SelectItem key={year} value={String(year)}>{year}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Export Format</label>
              <Select value={exportFormat} onValueChange={setExportFormat}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="PDF">PDF Document</SelectItem></SelectContent>
              </Select>
            </div>
          </div>
          <PremiumFeatureGate feature="exports" featureName="tax form exports" inline>
            <Button onClick={handleExport} disabled={isExporting || !canExport} className="w-full bg-blue-600 hover:bg-blue-700 text-white">
              <Download className="w-4 h-4 mr-2" />
              {isExporting ? 'Generating...' : `Export ${selectedYear} planning worksheet`}
            </Button>
          </PremiumFeatureGate>
        </Card>

        <Card className="p-6">
          <h2 className="text-xl font-semibold mb-4">Planning worksheet - Tax Year {selectedYear}</h2>

          {state.status === 'error' && (
            <div className="text-center py-12" role="alert">
              <AlertCircle className="w-16 h-16 text-red-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">Worksheet unavailable</h3>
              <p className="text-gray-600 mb-4">{state.message}</p>
              <Button onClick={() => void loadWorksheet()} variant="outline">Retry</Button>
            </div>
          )}

          {state.status === 'review' && (
            <div className="py-6" role="alert">
              <AlertCircle className="w-12 h-12 text-amber-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2 text-center">{state.code === 'HOME_OFFICE_REVIEW_REQUIRED' ? 'Home office facts need review' : 'Records need review before this worksheet'}</h3>
              <p className="text-sm text-gray-700 text-center mb-4">{state.message}</p>
              {state.reasons.length > 0 && (
                <ul className="text-sm text-gray-700 space-y-1 max-w-xl mx-auto list-disc pl-5 mb-4">
                  {state.reasons.map(reason => <li key={reason}>{reason}</li>)}
                </ul>
              )}
              <div className="text-center">
                <Button onClick={handleSetupSettings} className="bg-blue-600 hover:bg-blue-700 text-white">
                  <Home className="w-4 h-4 mr-2" />
                  {state.code === 'HOME_OFFICE_REVIEW_REQUIRED' ? 'Answer the home office questions' : 'Open Settings'}
                </Button>
              </div>
            </div>
          )}

          {state.status === 'ready' && !settings && (
            <div className="text-center py-12">
              <Home className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">Home office facts not saved</h3>
              <p className="text-gray-600 mb-4">Answer the Publication 587 questions (regular and exclusive use, qualifying use, square footage, months used, rented or owned) in Settings before this worksheet can be prepared.</p>
              <Button onClick={handleSetupSettings} className="bg-blue-600 hover:bg-blue-700 text-white">
                <Home className="w-4 h-4 mr-2" />
                Open home office settings
              </Button>
            </div>
          )}

          {state.status === 'ready' && settings && !worksheet && (
            <div className="py-6">
              <AlertCircle className="w-12 h-12 text-amber-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2 text-center">No home office amount is included yet</h3>
              <ul className="text-sm text-gray-700 space-y-1 max-w-xl mx-auto list-disc pl-5 mb-4">
                {state.data.reviewReasons.map(reason => <li key={reason}>{reason}</li>)}
              </ul>
              <div className="text-center">
                <Button onClick={handleSetupSettings} className="bg-blue-600 hover:bg-blue-700 text-white">
                  <Home className="w-4 h-4 mr-2" />
                  Complete the home office facts
                </Button>
              </div>
            </div>
          )}

          {state.status === 'ready' && worksheet && (
            <>
              <div className={`flex items-start gap-2 rounded-lg p-3 mb-6 text-sm ${worksheet.eligible ? 'bg-green-50 text-green-900' : 'bg-amber-50 text-amber-900'}`} role="status">
                {worksheet.eligible ? <CheckCircle className="w-4 h-4 mt-0.5 shrink-0" /> : <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />}
                <span>{worksheet.eligible ? 'Your saved answers indicate the area qualifies under §280A(c)(1). Your preparer must confirm eligibility.' : `Home office amount is $0: ${worksheet.ineligibleReason}`}</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <div className="text-center p-4 bg-green-50 rounded-lg">
                  <div className="text-2xl font-bold text-green-600">{worksheet.allowableSqFt}</div>
                  <div className="text-sm text-gray-600">Allowable sq ft (max {SIMPLIFIED_MAX_SQFT})</div>
                </div>
                <div className="text-center p-4 bg-blue-50 rounded-lg">
                  <div className="text-2xl font-bold text-blue-600">{worksheet.monthsUsed}/12</div>
                  <div className="text-sm text-gray-600">Months of qualified use</div>
                </div>
                <div className="text-center p-4 bg-purple-50 rounded-lg">
                  <div className="text-2xl font-bold text-purple-600">{money(worksheet.tentativeDeduction)}</div>
                  <div className="text-sm text-gray-600">Tentative ($5 x sq ft x months/12)</div>
                </div>
                <div className="text-center p-4 bg-orange-50 rounded-lg">
                  <div className="text-2xl font-bold text-orange-600">{money(worksheet.allowableDeduction)}</div>
                  <div className="text-sm text-gray-600">Schedule C line 30 (planning)</div>
                </div>
              </div>

              <h3 className="text-lg font-medium text-gray-900 mb-2">Simplified Method Worksheet (Schedule C instructions)</h3>
              <dl className="grid grid-cols-1 gap-2 text-sm mb-6">
                {[
                  ['Line 1 - Gross income from the business use minus other business expenses (Schedule C line 29 tentative profit)', money(worksheet.grossIncomeLimit)],
                  [`Line 2 - Allowable square feet (office ${worksheet.officeSqFt} of ${worksheet.totalHomeSqFt} sq ft; limit ${SIMPLIFIED_MAX_SQFT})`, `${worksheet.allowableSqFt} sq ft`],
                  ['Line 3a - Average monthly allowable square feet', `${worksheet.averageMonthlyAllowableSqFt} sq ft`],
                  ['Line 3b - Prescribed rate', `${money(worksheet.ratePerSqFt)} per sq ft`],
                  ['Line 3c - Tentative amount', money(worksheet.tentativeDeduction)],
                  ['Line 4 - Allowable amount (smaller of line 1 and 3c)', money(worksheet.allowableDeduction)],
                  ['Excess not allowed (no carryover under the simplified method)', money(worksheet.disallowedNoCarryover)],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-4 p-3 bg-gray-50 rounded-lg">
                    <dt className="text-gray-700">{label}</dt>
                    <dd className="font-semibold text-gray-900 whitespace-nowrap">{value}</dd>
                  </div>
                ))}
              </dl>

              <h3 className="text-lg font-medium text-gray-900 mb-2">Saved facts</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm mb-6">
                {[
                  ['Regular use', settings?.regularUse ?? 'Not answered'], ['Exclusive use', settings?.exclusiveUse ?? 'Not answered'],
                  ['Qualifying use', settings?.qualifyingUse ?? 'Not answered'], ['Rented or owned', settings?.housingType ?? 'Not answered'],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between p-3 bg-gray-50 rounded-lg"><span className="text-gray-600">{label}</span><span className="font-medium capitalize">{String(value).replaceAll('_', ' ')}</span></div>
                ))}
              </div>

              {(worksheet.notes.length > 0 || state.data.warnings.length > 0) && (
                <div className="text-xs text-gray-600 space-y-1">
                  {[...worksheet.notes, ...state.data.warnings].map(note => <p key={note}>• {note}</p>)}
                </div>
              )}
            </>
          )}
        </Card>

        <Card className="p-6">
          <h2 className="text-xl font-semibold mb-4">About this worksheet</h2>
          <div className="text-center py-6">
            <Calculator className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">Simplified method vs. Form 8829</h3>
            <div className="text-sm text-gray-500 space-y-1 max-w-2xl mx-auto text-left">
              <p>• Simplified method (Rev. Proc. 2013-13): $5 per square foot of qualified business use, up to 300 square feet ($1,500), prorated by months, limited to the gross income from the business use of the home minus other business expenses. No carryover and no home depreciation for the year.</p>
              <p>• The actual-expense method uses Form 8829 and needs the line 8 income ordering, mortgage interest and real estate tax allocation, depreciation of an owned home, casualty losses and prior-year carryovers. Settings do not collect those facts, so that method stays with your preparer.</p>
              <p>• Eligibility requires regular and exclusive use of a specific area as your principal place of business, a place to meet clients, or a separate structure (§280A(c)(1); Publication 587). Daycare and inventory-storage exceptions need review.</p>
            </div>
          </div>
        </Card>
      </div>

      <ToastContainer toasts={toasts} onClose={removeToast} />
    </div>
  );
}
