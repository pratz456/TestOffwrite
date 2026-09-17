"use client";

import { SUPPORTED_TAX_YEARS } from '@/lib/tax-rules/federal-year-rules';
import { PremiumFeatureGate } from '@/components/premium-feature-gate';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Download, Calculator, Plus, Trash2, AlertCircle } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { useAuth } from '@/lib/firebase/auth-context';
import { useToasts } from '@/components/ui/toast';
import { ToastContainer } from '@/components/ui/toast';
import { makeAuthenticatedRequest } from '@/lib/firebase/api-client';
import { type Asset, type AssetCalculation, type Form4562Calculation, type DepreciationElections } from '@/lib/reports/calc4562';

interface Form4562Worksheet {
  taxYear: number;
  assets: Asset[];
  calculation: Form4562Calculation | null;
  businessIncome: number;
  elections: DepreciationElections;
  deMinimisElected: boolean;
  deMinimisLimit: number;
  section179Limits: { limit: number; phaseoutThreshold: number; source: string; taxYear: number } | null;
}
type WorksheetState =
  | { status: 'loading' }
  | { status: 'ready'; data: Form4562Worksheet }
  | { status: 'review'; code: string; message: string }
  | { status: 'error'; message: string };

const money = (value: number) => value.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 });
const TREATMENT_LABELS: Record<AssetCalculation['treatment'], string> = {
  de_minimis_expense: 'De minimis safe harbor - expensed, not depreciated',
  section_179: 'Section 179 election + MACRS on remaining basis',
  macrs: 'MACRS half-year',
};
const emptyAsset = (): Partial<Asset> => ({
  description: '', datePlacedInService: new Date(), cost: 0, businessUsePercent: 100,
  category: 'other', method: 'MACRS_5YR', section179Requested: false, bonusEligible: false,
});

export default function Form4562Page() {
  const router = useRouter();
  const { user } = useAuth();
  const { toasts, removeToast, showSuccess, showError } = useToasts();

  const [selectedYear, setSelectedYear] = useState(String(SUPPORTED_TAX_YEARS[SUPPORTED_TAX_YEARS.length - 1]));
  const [exportFormat, setExportFormat] = useState('PDF');
  const [isExporting, setIsExporting] = useState(false);
  const [state, setState] = useState<WorksheetState>({ status: 'loading' });
  const [assets, setAssets] = useState<Asset[]>([]);
  const [showAddAsset, setShowAddAsset] = useState(false);
  const [newAsset, setNewAsset] = useState<Partial<Asset>>(emptyAsset);
  const requestId = useRef(0);

  const loadWorksheet = useCallback(async () => {
    const current = ++requestId.current;
    setState({ status: 'loading' });
    try {
      const response = await makeAuthenticatedRequest(`/api/tax/form-4562?year=${selectedYear}`);
      const body = await response.json().catch(() => ({}));
      if (current !== requestId.current) return;
      if (response.status === 422 && typeof body.code === 'string') {
        // Assets are still listed so the unsupported record can be removed or corrected.
        const listed = await makeAuthenticatedRequest('/api/settings/assets').then(res => res.ok ? res.json() : { data: [] }).catch(() => ({ data: [] }));
        if (current !== requestId.current) return;
        setAssets(Array.isArray(listed.data) ? listed.data : []);
        setState({ status: 'review', code: body.code, message: body.error || 'Review the saved asset records before calculating.' });
        return;
      }
      if (!response.ok) throw new Error(body.error || 'The depreciation worksheet could not be loaded.');
      setAssets(Array.isArray(body.assets) ? body.assets : []);
      setState({ status: 'ready', data: body as Form4562Worksheet });
    } catch (error) {
      if (current !== requestId.current) return;
      setState({ status: 'error', message: error instanceof Error ? error.message : 'The depreciation worksheet could not be loaded.' });
    }
  }, [selectedYear]);

  useEffect(() => {
    if (user) void loadWorksheet();
    return () => { requestId.current += 1; };
  }, [user, loadWorksheet]);

  const handleBack = () => { router.push('/protected/reports'); };
  const handleSetupSettings = () => { router.push('/protected/tax-forms-setup?tab=assets'); };
  const handleElectionSettings = () => { router.push('/protected/settings?tab=tax'); };
  const calculation = state.status === 'ready' ? state.data.calculation : null;
  const canExport = state.status === 'ready' && calculation !== null;

  const handleExport = async () => {
    if (!canExport) {
      showError('Review needed', 'Resolve the asset review items before exporting the worksheet.');
      return;
    }
    setIsExporting(true);
    try {
      const response = await makeAuthenticatedRequest('/api/reports/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ type: 'form4562', year: Number(selectedYear) }),
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to generate report');
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const today = new Date().toISOString().split('T')[0];
      a.download = `form4562_${selectedYear}_${today}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      showSuccess('Export Successful', 'The Form 4562 planning worksheet has been downloaded');
    } catch (error) {
      console.error('Export error:', error);
      showError('Export Failed', error instanceof Error ? error.message : 'Failed to export data');
    } finally {
      setIsExporting(false);
    }
  };

  const handleAddAsset = async () => {
    if (!newAsset.description || !newAsset.cost || !newAsset.datePlacedInService) {
      showError('Missing Information', 'Please fill in all required asset fields');
      return;
    }
    try {
      const response = await makeAuthenticatedRequest('/api/settings/assets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assets: [{ ...newAsset, datePlacedInService: new Date(newAsset.datePlacedInService) }] }),
      });
      if (!response.ok) throw new Error('Failed to add asset');
      showSuccess('Asset Added', 'Asset has been added successfully');
      setNewAsset(emptyAsset());
      setShowAddAsset(false);
      void loadWorksheet();
    } catch {
      showError('Add Failed', 'Failed to add asset. Please try again.');
    }
  };

  const handleRemoveAsset = async (assetId: string) => {
    try {
      const response = await makeAuthenticatedRequest('/api/settings/assets', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetId }),
      });
      if (!response.ok) throw new Error('Failed to remove asset');
      showSuccess('Asset Removed', 'Asset has been removed successfully');
      void loadWorksheet();
    } catch {
      showError('Remove Failed', 'Failed to remove asset. Please try again.');
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

  const assetForm = (
    <div className="border rounded-lg p-4 bg-gray-50">
      <h4 className="font-medium mb-4">Add New Asset</h4>
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <Label htmlFor="description">Description</Label>
          <Input id="description" value={newAsset.description} onChange={(e) => setNewAsset({ ...newAsset, description: e.target.value })} placeholder="e.g., MacBook Pro" />
        </div>
        <div>
          <Label htmlFor="cost">Cost (per item, as shown on the invoice)</Label>
          <Input id="cost" type="number" value={newAsset.cost} onChange={(e) => setNewAsset({ ...newAsset, cost: Number(e.target.value) })} />
        </div>
        <div>
          <Label htmlFor="datePlacedInService">Date Placed in Service</Label>
          <Input id="datePlacedInService" type="date" value={newAsset.datePlacedInService ? new Date(newAsset.datePlacedInService).toISOString().split('T')[0] : ''} onChange={(e) => setNewAsset({ ...newAsset, datePlacedInService: new Date(e.target.value) })} />
        </div>
        <div>
          <Label htmlFor="businessUsePercent">Business Use %</Label>
          <Input id="businessUsePercent" type="number" min="0" max="100" value={newAsset.businessUsePercent} onChange={(e) => setNewAsset({ ...newAsset, businessUsePercent: Number(e.target.value) })} />
        </div>
        <div>
          <Label htmlFor="category">Category</Label>
          <Select value={newAsset.category} onValueChange={(value) => setNewAsset({ ...newAsset, category: value as Asset['category'] })}>
            <SelectTrigger id="category"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="computer">Computer</SelectItem>
              <SelectItem value="furniture">Furniture</SelectItem>
              <SelectItem value="vehicle">Vehicle (review required)</SelectItem>
              <SelectItem value="equipment">Equipment</SelectItem>
              <SelectItem value="other">Other (review required)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="method">Depreciation Method</Label>
          <Select value={newAsset.method} onValueChange={(value) => setNewAsset({ ...newAsset, method: value as Asset['method'] })}>
            <SelectTrigger id="method"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="MACRS_5YR">MACRS 5-Year</SelectItem>
              <SelectItem value="MACRS_7YR">MACRS 7-Year</SelectItem>
              <SelectItem value="SL">Straight Line (review required)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex flex-wrap gap-4 mb-4">
        <div className="flex items-center space-x-2">
          <Checkbox id="section179" checked={newAsset.section179Requested} onCheckedChange={(checked) => setNewAsset({ ...newAsset, section179Requested: !!checked })} />
          <Label htmlFor="section179">Elect Section 179 (needs more than 50% business use; 2025-2026 property)</Label>
        </div>
        <div className="flex items-center space-x-2">
          <Checkbox id="bonusEligible" checked={newAsset.bonusEligible} onCheckedChange={(checked) => setNewAsset({ ...newAsset, bonusEligible: !!checked })} />
          <Label htmlFor="bonusEligible">Bonus depreciation (review required)</Label>
        </div>
      </div>
      <div className="flex gap-2">
        <Button onClick={handleAddAsset}><Plus className="w-4 h-4 mr-2" />Add Asset</Button>
        <Button variant="outline" onClick={() => setShowAddAsset(false)}>Cancel</Button>
      </div>
    </div>
  );

  const assetList = (
    <div className="space-y-2">
      {assets.map((asset) => {
        const assetCalc = calculation?.assets.find(row => row.asset.id === asset.id);
        return (
          <div key={asset.id} className="flex items-center justify-between p-3 border rounded-lg">
            <div className="flex-1">
              <div className="font-medium">{asset.description}</div>
              <div className="text-sm text-gray-500">
                {money(asset.cost)} • {asset.businessUsePercent}% business use • {asset.category}{asset.section179Requested ? ' • §179 requested' : ''}{asset.bonusEligible ? ' • bonus (review)' : ''}
              </div>
              {assetCalc && (
                <div className="text-sm text-blue-600">
                  {TREATMENT_LABELS[assetCalc.treatment]}
                  {assetCalc.treatment === 'de_minimis_expense'
                    ? ` • expensed ${money(assetCalc.deMinimisExpense)}`
                    : ` • §179 ${money(assetCalc.section179Deduction)} • MACRS ${money(assetCalc.regularDepreciation)}${assetCalc.carryoverToNextYear ? ` • §179 carryover ${money(assetCalc.carryoverToNextYear)}` : ''}`}
                </div>
              )}
            </div>
            <Button variant="outline" size="sm" onClick={() => handleRemoveAsset(asset.id)} aria-label={`Remove ${asset.description}`}>
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <div className="flex items-center gap-4 mb-6">
        <button onClick={handleBack} className="p-2 hover:bg-gray-200 rounded-lg transition-colors" aria-label="Back to reports">
          <ArrowLeft className="w-5 h-5 text-gray-600" />
        </button>
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Form 4562 Worksheet</h1>
          <p className="text-gray-600">Planning worksheet for depreciation, Section 179 and de minimis expensing. Not an IRS form.</p>
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
              {isExporting ? 'Generating...' : `Export ${selectedYear} Form 4562 worksheet`}
            </Button>
          </PremiumFeatureGate>
        </Card>

        <Card className="p-6">
          <h2 className="text-xl font-semibold mb-4">Worksheet preview - Tax Year {selectedYear}</h2>

          {state.status === 'error' && (
            <div className="text-center py-12" role="alert">
              <AlertCircle className="w-16 h-16 text-red-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">Worksheet unavailable</h3>
              <p className="text-gray-600 mb-4">{state.message}</p>
              <Button onClick={() => void loadWorksheet()} variant="outline">Retry</Button>
            </div>
          )}

          {state.status === 'review' && (
            <div className="space-y-4" role="alert">
              <div className="text-center py-6">
                <AlertCircle className="w-12 h-12 text-amber-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">Asset records need review</h3>
                <p className="text-sm text-gray-700 max-w-xl mx-auto">{state.message}</p>
              </div>
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-medium text-gray-900">Saved assets ({assets.length})</h3>
                <Button onClick={() => setShowAddAsset(!showAddAsset)} variant="outline" size="sm"><Plus className="w-4 h-4 mr-2" />Add Asset</Button>
              </div>
              {showAddAsset && assetForm}
              {assetList}
            </div>
          )}

          {state.status === 'ready' && assets.length === 0 && (
            <div className="text-center py-12">
              <Calculator className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No Business Assets Found</h3>
              <p className="text-gray-600 mb-4">Add your business assets before preparing the Form 4562 worksheet.</p>
              <div className="flex justify-center gap-2">
                <Button onClick={() => setShowAddAsset(true)} className="bg-blue-600 hover:bg-blue-700 text-white"><Plus className="w-4 h-4 mr-2" />Add Business Assets</Button>
                <Button onClick={handleSetupSettings} variant="outline">Open asset settings</Button>
              </div>
              {showAddAsset && <div className="mt-6 text-left">{assetForm}</div>}
            </div>
          )}

          {state.status === 'ready' && calculation && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <div className="text-center p-4 bg-green-50 rounded-lg">
                  <div className="text-2xl font-bold text-green-600">{money(calculation.totalDeMinimisExpense)}</div>
                  <div className="text-sm text-gray-600">De minimis expensed (Schedule C)</div>
                </div>
                <div className="text-center p-4 bg-blue-50 rounded-lg">
                  <div className="text-2xl font-bold text-blue-600">{money(calculation.totalSection179)}</div>
                  <div className="text-sm text-gray-600">Section 179 allowed{calculation.totalCarryover ? ` (+${money(calculation.totalCarryover)} carryover)` : ''}</div>
                </div>
                <div className="text-center p-4 bg-purple-50 rounded-lg">
                  <div className="text-2xl font-bold text-purple-600">{money(calculation.totalRegularDepreciation)}</div>
                  <div className="text-sm text-gray-600">Regular MACRS depreciation</div>
                </div>
                <div className="text-center p-4 bg-orange-50 rounded-lg">
                  <div className="text-2xl font-bold text-orange-600">{money(calculation.totalDepreciation)}</div>
                  <div className="text-sm text-gray-600">Total depreciation (line 22)</div>
                </div>
              </div>

              {calculation.section179 && (
                <div className="mb-6 rounded-lg border p-4 text-sm">
                  <h3 className="font-medium text-gray-900 mb-2">Section 179 limits applied for {calculation.section179.electionYear}</h3>
                  <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1 text-gray-700">
                    <div className="flex justify-between"><dt>Dollar limit ({calculation.section179.source})</dt><dd className="font-medium">{money(calculation.section179.limit)}</dd></div>
                    <div className="flex justify-between"><dt>Phaseout threshold</dt><dd className="font-medium">{money(calculation.section179.phaseoutThreshold)}</dd></div>
                    <div className="flex justify-between"><dt>Business income limit (§179(b)(3)(A))</dt><dd className="font-medium">{money(calculation.section179.businessIncomeLimit)}</dd></div>
                    <div className="flex justify-between"><dt>Elected / allowed / carryover</dt><dd className="font-medium">{money(calculation.section179.elected)} / {money(calculation.section179.allowed)} / {money(calculation.section179.carryover)}</dd></div>
                  </dl>
                </div>
              )}

              {calculation.notes.length > 0 && (
                <div className="mb-6 text-xs text-gray-600 space-y-1">
                  {calculation.notes.map(note => <p key={note}>• {note}</p>)}
                </div>
              )}

              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <h3 className="text-lg font-medium text-gray-900">Business Assets ({assets.length})</h3>
                  <Button onClick={() => setShowAddAsset(!showAddAsset)} variant="outline" size="sm"><Plus className="w-4 h-4 mr-2" />Add Asset</Button>
                </div>
                {showAddAsset && assetForm}
                {assetList}
              </div>
            </>
          )}
        </Card>

        <Card className="p-6">
          <h2 className="text-xl font-semibold mb-4">Limits used for {selectedYear}</h2>
          <div className="text-center py-6">
            <Calculator className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">Form 4562 - Depreciation and Amortization</h3>
            <div className="text-sm text-gray-500 space-y-1 max-w-2xl mx-auto text-left">
              {state.status === 'ready' && state.data.section179Limits ? (
                <p>• Section 179 dollar limit for {state.data.section179Limits.taxYear}: {money(state.data.section179Limits.limit)}; phaseout begins at {money(state.data.section179Limits.phaseoutThreshold)} of §179 property ({state.data.section179Limits.source}). Limited to business taxable income under §179(b)(3); the excess carries forward.</p>
              ) : (
                <p>• Section 179 is calculated for property placed in service in 2025 or 2026 using the published limits; other years stay in preparer review.</p>
              )}
              <p>• De minimis safe harbor (Reg. §1.263(a)-1(f)): items at or under {state.status === 'ready' ? money(state.data.deMinimisLimit) : '$2,500'} per invoice or item are current expenses when the annual election is made.{' '}
                {state.status === 'ready' && (state.data.deMinimisElected ? `You have recorded the ${selectedYear} election in Settings.` : `No ${selectedYear} election is recorded; such items are depreciated until you record it in Settings.`)}{' '}
                <button type="button" className="underline" onClick={handleElectionSettings}>Manage election</button>
              </p>
              <p>• Business income for the §179 limit comes from your Schedule C records plus W-2 wages{state.status === 'ready' ? ` (${money(state.data.businessIncome)} for ${selectedYear})` : ''}.</p>
              <p>• Bonus depreciation, vehicles and other listed property, prior-year assets, straight-line and mid-quarter cases require preparer review and are not calculated.</p>
            </div>
          </div>
        </Card>
      </div>

      <ToastContainer toasts={toasts} onClose={removeToast} />
    </div>
  );
}
