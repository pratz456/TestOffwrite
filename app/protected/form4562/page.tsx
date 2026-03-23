"use client";

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Download, Calculator, Plus, Trash2, AlertCircle, CheckCircle } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { useAuth } from '@/lib/firebase/auth-context';
import { useToasts } from '@/components/ui/toast';
import { ToastContainer } from '@/components/ui/toast';
import { calc4562, validateAssets, Asset } from '@/lib/reports/calc4562';

export default function Form4562Page() {
  const router = useRouter();
  const { user } = useAuth();
  const { toasts, removeToast, showSuccess, showError } = useToasts();

  const [selectedYear, setSelectedYear] = useState('2024');
  const [exportFormat, setExportFormat] = useState('PDF');
  const [isExporting, setIsExporting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [calculation, setCalculation] = useState<any>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [businessIncome, setBusinessIncome] = useState(0);
  const [showAddAsset, setShowAddAsset] = useState(false);
  const [newAsset, setNewAsset] = useState<Partial<Asset>>({
    description: '',
    datePlacedInService: new Date(),
    cost: 0,
    businessUsePercent: 100,
    category: 'other',
    method: 'MACRS_5YR',
    section179Requested: false,
    bonusEligible: false,
  });

  useEffect(() => {
    if (user) {
      loadAssets();
      fetchBusinessIncome();
    }
  }, [user]);

  const fetchBusinessIncome = async () => {
    try {
      const res = await fetch(`/api/tax/compute-1040?year=${selectedYear}`);
      if (res.ok) {
        const data = await res.json();
        setBusinessIncome(data.income?.scheduleCNetProfit || 0);
      }
    } catch {
      // Fall back to 0
    }
  };

  const loadAssets = async () => {
    try {
      setIsLoading(true);
      const response = await fetch('/api/settings/assets');

      if (response.ok) {
        const { data } = await response.json();
        setAssets(data || []);

        if (data && data.length > 0) {
          const calc = calc4562(data, businessIncome || 0);
          setCalculation(calc);

          const errors = validateAssets(data);
          setValidationErrors(errors);
        } else {
          setCalculation(null);
          setValidationErrors(['No business assets found']);
        }
      } else if (response.status === 404) {
        setAssets([]);
        setValidationErrors(['No business assets found']);
      }
    } catch (error) {
      console.error('Error loading assets:', error);
      showError('Load Failed', 'Failed to load business assets');
    } finally {
      setIsLoading(false);
    }
  };

  const handleBack = () => {
    router.push('/protected/reports');
  };

  const handleExport = async () => {
    if (assets.length === 0) {
      showError('Missing Data', 'Please add your business assets first');
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
        body: JSON.stringify({ type: 'form4562' }),
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
      a.download = `form4562_${today}.pdf`;

      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      showSuccess('Export Successful', 'Form 4562 has been generated and downloaded successfully');

    } catch (error) {
      console.error('Export error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to export data';
      showError('Export Failed', errorMessage);
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
      const assetData = {
        ...newAsset,
        datePlacedInService: new Date(newAsset.datePlacedInService),
      };

      const response = await fetch('/api/settings/assets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assets: [assetData] }),
      });

      if (response.ok) {
        showSuccess('Asset Added', 'Asset has been added successfully');
        setNewAsset({
          description: '',
          datePlacedInService: new Date(),
          cost: 0,
          businessUsePercent: 100,
          category: 'other',
          method: 'MACRS_5YR',
          section179Requested: false,
          bonusEligible: false,
        });
        setShowAddAsset(false);
        loadAssets(); // Reload assets
      } else {
        throw new Error('Failed to add asset');
      }
    } catch (error) {
      showError('Add Failed', 'Failed to add asset. Please try again.');
    }
  };

  const handleRemoveAsset = async (assetId: string) => {
    try {
      const response = await fetch('/api/settings/assets', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetId }),
      });

      if (response.ok) {
        showSuccess('Asset Removed', 'Asset has been removed successfully');
        loadAssets(); // Reload assets
      } else {
        throw new Error('Failed to remove asset');
      }
    } catch (error) {
      showError('Remove Failed', 'Failed to remove asset. Please try again.');
    }
  };

  const handleSetupSettings = () => {
    router.push('/protected/tax-forms-setup?tab=assets');
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
          <h1 className="text-3xl font-bold text-gray-900">Form 4562 Export</h1>
          <p className="text-gray-600">Export your depreciation and amortization for tax filing</p>
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
            disabled={isExporting || assets.length === 0 || validationErrors.length > 0}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white"
          >
            <Download className="w-4 h-4 mr-2" />
            {isExporting ? 'Generating...' : `Export ${selectedYear} Form 4562`}
          </Button>
        </Card>

        {/* Form 4562 Preview */}
        <Card className="p-6">
          <h2 className="text-xl font-semibold mb-4">Form 4562 Preview - Tax Year {selectedYear}</h2>

          {assets.length === 0 ? (
            <div className="text-center py-12">
              <Calculator className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No Business Assets Found</h3>
              <p className="text-gray-600 mb-4">
                You need to add your business assets before generating Form 4562.
              </p>
              <Button onClick={handleSetupSettings} className="bg-blue-600 hover:bg-blue-700 text-white">
                <Plus className="w-4 h-4 mr-2" />
                Add Business Assets
              </Button>
            </div>
          ) : validationErrors.length > 0 ? (
            <div className="text-center py-12">
              <AlertCircle className="w-16 h-16 text-red-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">Asset Configuration Issues</h3>
              <div className="text-left max-w-md mx-auto mb-4">
                <ul className="text-sm text-red-600 space-y-1">
                  {validationErrors.map((error, index) => (
                    <li key={index}>• {error}</li>
                  ))}
                </ul>
              </div>
              <Button onClick={handleSetupSettings} className="bg-blue-600 hover:bg-blue-700 text-white">
                <Calculator className="w-4 h-4 mr-2" />
                Fix Asset Configuration
              </Button>
            </div>
          ) : calculation ? (
            <>
              {/* Summary Cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <div className="text-center p-4 bg-green-50 rounded-lg">
                  <div className="text-2xl font-bold text-green-600">
                    ${calculation.totalSection179.toFixed(0)}
                  </div>
                  <div className="text-sm text-gray-600">Section 179</div>
                </div>
                <div className="text-center p-4 bg-blue-50 rounded-lg">
                  <div className="text-2xl font-bold text-blue-600">
                    ${calculation.totalBonusDepreciation.toFixed(0)}
                  </div>
                  <div className="text-sm text-gray-600">Bonus Depreciation</div>
                </div>
                <div className="text-center p-4 bg-purple-50 rounded-lg">
                  <div className="text-2xl font-bold text-purple-600">
                    ${calculation.totalRegularDepreciation.toFixed(0)}
                  </div>
                  <div className="text-sm text-gray-600">Regular Depreciation</div>
                </div>
                <div className="text-center p-4 bg-orange-50 rounded-lg">
                  <div className="text-2xl font-bold text-orange-600">
                    ${calculation.totalDepreciation.toFixed(0)}
                  </div>
                  <div className="text-sm text-gray-600">Total Depreciation</div>
                </div>
              </div>

              {/* Assets List */}
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <h3 className="text-lg font-medium text-gray-900">Business Assets ({assets.length})</h3>
                  <Button
                    onClick={() => setShowAddAsset(!showAddAsset)}
                    variant="outline"
                    size="sm"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Add Asset
                  </Button>
                </div>

                {/* Add Asset Form */}
                {showAddAsset && (
                  <div className="border rounded-lg p-4 bg-gray-50">
                    <h4 className="font-medium mb-4">Add New Asset</h4>
                    <div className="grid grid-cols-2 gap-4 mb-4">
                      <div>
                        <Label htmlFor="description">Description</Label>
                        <Input
                          id="description"
                          value={newAsset.description}
                          onChange={(e) => setNewAsset({ ...newAsset, description: e.target.value })}
                          placeholder="e.g., MacBook Pro"
                        />
                      </div>
                      <div>
                        <Label htmlFor="cost">Cost</Label>
                        <Input
                          id="cost"
                          type="number"
                          value={newAsset.cost}
                          onChange={(e) => setNewAsset({ ...newAsset, cost: Number(e.target.value) })}
                        />
                      </div>
                      <div>
                        <Label htmlFor="datePlacedInService">Date Placed in Service</Label>
                        <Input
                          id="datePlacedInService"
                          type="date"
                          value={newAsset.datePlacedInService ? new Date(newAsset.datePlacedInService).toISOString().split('T')[0] : ''}
                          onChange={(e) => setNewAsset({ ...newAsset, datePlacedInService: new Date(e.target.value) })}
                        />
                      </div>
                      <div>
                        <Label htmlFor="businessUsePercent">Business Use %</Label>
                        <Input
                          id="businessUsePercent"
                          type="number"
                          min="0"
                          max="100"
                          value={newAsset.businessUsePercent}
                          onChange={(e) => setNewAsset({ ...newAsset, businessUsePercent: Number(e.target.value) })}
                        />
                      </div>
                      <div>
                        <Label htmlFor="category">Category</Label>
                        <Select value={newAsset.category} onValueChange={(value) => setNewAsset({ ...newAsset, category: value as any })}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="computer">Computer</SelectItem>
                            <SelectItem value="furniture">Furniture</SelectItem>
                            <SelectItem value="vehicle">Vehicle</SelectItem>
                            <SelectItem value="equipment">Equipment</SelectItem>
                            <SelectItem value="other">Other</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label htmlFor="method">Depreciation Method</Label>
                        <Select value={newAsset.method} onValueChange={(value) => setNewAsset({ ...newAsset, method: value as any })}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="MACRS_5YR">MACRS 5-Year</SelectItem>
                            <SelectItem value="MACRS_7YR">MACRS 7-Year</SelectItem>
                            <SelectItem value="SL">Straight Line</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="flex gap-4 mb-4">
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="section179"
                          checked={newAsset.section179Requested}
                          onCheckedChange={(checked) => setNewAsset({ ...newAsset, section179Requested: !!checked })}
                        />
                        <Label htmlFor="section179">Section 179 Requested</Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="bonusEligible"
                          checked={newAsset.bonusEligible}
                          onCheckedChange={(checked) => setNewAsset({ ...newAsset, bonusEligible: !!checked })}
                        />
                        <Label htmlFor="bonusEligible">Bonus Depreciation Eligible</Label>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button onClick={handleAddAsset}>
                        <Plus className="w-4 h-4 mr-2" />
                        Add Asset
                      </Button>
                      <Button variant="outline" onClick={() => setShowAddAsset(false)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}

                {/* Assets List */}
                <div className="space-y-2">
                  {assets.map((asset) => {
                    const assetCalc = calculation.assets.find((a: any) => a.asset.id === asset.id);
                    return (
                      <div key={asset.id} className="flex items-center justify-between p-3 border rounded-lg">
                        <div className="flex-1">
                          <div className="font-medium">{asset.description}</div>
                          <div className="text-sm text-gray-500">
                            ${asset.cost.toLocaleString()} • {asset.businessUsePercent}% business use • {asset.category}
                          </div>
                          {assetCalc && (
                            <div className="text-sm text-blue-600">
                              Total Depreciation: ${assetCalc.totalDepreciation.toFixed(2)}
                            </div>
                          )}
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleRemoveAsset(asset.id)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          ) : null}
        </Card>

        {/* IRS Form 4562 Information */}
        <Card className="p-6">
          <h2 className="text-xl font-semibold mb-4">IRS Form 4562 Information</h2>
          <div className="text-center py-8">
            <Calculator className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">Form 4562 - Depreciation and Amortization</h3>
            <p className="text-gray-600 mb-4">
              This form calculates depreciation and amortization for your business assets.
            </p>
            <div className="text-sm text-gray-500 space-y-1">
              <p>• Section 179 limit for 2024: $1,160,000</p>
              <p>• Bonus depreciation rate for 2024: 60%</p>
              <p>• MACRS and Straight Line depreciation methods</p>
              <p>• Business use percentage affects deductions</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Toast Container */}
      <ToastContainer toasts={toasts} onClose={removeToast} />
    </div>
  );
}
