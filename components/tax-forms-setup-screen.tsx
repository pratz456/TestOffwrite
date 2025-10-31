"use client";

import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Home, Calculator, User, Save, Plus, Trash2 } from 'lucide-react';
import { useToasts } from '@/components/ui/toast';
import { useAuth } from '@/lib/firebase/auth-context';

interface HomeOfficeSettings {
  totalHomeSqFt: number;
  officeSqFt: number;
  rentOrMortgageInterest: number;
  utilities: number;
  insurance: number;
  repairsMaintenance: number;
  propertyTax: number;
  other: number;
}

interface Asset {
  id: string;
  description: string;
  datePlacedInService: string;
  cost: number;
  businessUsePercent: number;
  category: 'computer' | 'furniture' | 'vehicle' | 'equipment' | 'other';
  method: 'MACRS_5YR' | 'MACRS_7YR' | 'SL';
  section179Requested: boolean;
  bonusEligible: boolean;
}

interface TaxSummarySettings {
  scheduleCNetProfit: number;
  taxYear: number;
  adjustments: number;
}

export function TaxFormsSetupScreen() {
  const { user } = useAuth();
  const { showSuccess, showError } = useToasts();
  
  const [activeTab, setActiveTab] = useState<'homeOffice' | 'assets' | 'taxSummary'>('homeOffice');
  const [isLoading, setIsLoading] = useState(false);
  
  // Home Office Settings
  const [homeOfficeSettings, setHomeOfficeSettings] = useState<HomeOfficeSettings>({
    totalHomeSqFt: 0,
    officeSqFt: 0,
    rentOrMortgageInterest: 0,
    utilities: 0,
    insurance: 0,
    repairsMaintenance: 0,
    propertyTax: 0,
    other: 0,
  });
  
  // Assets
  const [assets, setAssets] = useState<Asset[]>([]);
  const [newAsset, setNewAsset] = useState<Partial<Asset>>({
    description: '',
    datePlacedInService: '',
    cost: 0,
    businessUsePercent: 100,
    category: 'other',
    method: 'MACRS_5YR',
    section179Requested: false,
    bonusEligible: false,
  });
  
  // Tax Summary
  const [taxSummary, setTaxSummary] = useState<TaxSummarySettings>({
    scheduleCNetProfit: 0,
    taxYear: new Date().getFullYear(),
    adjustments: 0,
  });

  const handleSaveHomeOffice = async () => {
    if (!user) return;
    
    setIsLoading(true);
    try {
      const response = await fetch('/api/settings/home-office', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(homeOfficeSettings),
      });
      
      if (response.ok) {
        showSuccess('Home Office Settings Saved', 'Your home office settings have been saved successfully.');
      } else {
        throw new Error('Failed to save home office settings');
      }
    } catch (error) {
      showError('Save Failed', 'Failed to save home office settings. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddAsset = () => {
    if (!newAsset.description || !newAsset.datePlacedInService || !newAsset.cost) {
      showError('Missing Information', 'Please fill in all required asset fields.');
      return;
    }
    
    const asset: Asset = {
      id: Date.now().toString(),
      description: newAsset.description,
      datePlacedInService: newAsset.datePlacedInService,
      cost: newAsset.cost,
      businessUsePercent: newAsset.businessUsePercent || 100,
      category: newAsset.category || 'other',
      method: newAsset.method || 'MACRS_5YR',
      section179Requested: newAsset.section179Requested || false,
      bonusEligible: newAsset.bonusEligible || false,
    };
    
    setAssets([...assets, asset]);
    setNewAsset({
      description: '',
      datePlacedInService: '',
      cost: 0,
      businessUsePercent: 100,
      category: 'other',
      method: 'MACRS_5YR',
      section179Requested: false,
      bonusEligible: false,
    });
    
    showSuccess('Asset Added', 'Asset has been added to your list.');
  };

  const handleRemoveAsset = (assetId: string) => {
    setAssets(assets.filter(asset => asset.id !== assetId));
    showSuccess('Asset Removed', 'Asset has been removed from your list.');
  };

  const handleSaveAssets = async () => {
    if (!user) return;
    
    setIsLoading(true);
    try {
      const response = await fetch('/api/settings/assets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assets }),
      });
      
      if (response.ok) {
        showSuccess('Assets Saved', 'Your business assets have been saved successfully.');
      } else {
        throw new Error('Failed to save assets');
      }
    } catch (error) {
      showError('Save Failed', 'Failed to save assets. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveTaxSummary = async () => {
    if (!user) return;
    
    setIsLoading(true);
    try {
      const response = await fetch('/api/settings/tax-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(taxSummary),
      });
      
      if (response.ok) {
        showSuccess('Tax Summary Saved', 'Your tax summary settings have been saved successfully.');
      } else {
        throw new Error('Failed to save tax summary');
      }
    } catch (error) {
      showError('Save Failed', 'Failed to save tax summary. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <div className="max-w-4xl mx-auto">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Tax Forms Setup</h1>
          <p className="text-gray-600">Configure your settings for generating tax forms</p>
        </div>

        {/* Tabs */}
        <div className="flex space-x-1 mb-6 bg-white rounded-lg p-1 w-fit">
          <button
            onClick={() => setActiveTab('homeOffice')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2 ${
              activeTab === 'homeOffice'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <Home className="w-4 h-4" />
            Home Office
          </button>
          <button
            onClick={() => setActiveTab('assets')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2 ${
              activeTab === 'assets'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <Calculator className="w-4 h-4" />
            Assets
          </button>
          <button
            onClick={() => setActiveTab('taxSummary')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2 ${
              activeTab === 'taxSummary'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <User className="w-4 h-4" />
            Tax Summary
          </button>
        </div>

        {/* Home Office Tab */}
        {activeTab === 'homeOffice' && (
          <Card className="p-6">
            <h2 className="text-xl font-semibold mb-4">Home Office Settings</h2>
            <p className="text-gray-600 mb-6">Configure your home office information for Form 8829</p>
            
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div>
                <Label htmlFor="totalHomeSqFt">Total Home Square Footage</Label>
                <Input
                  id="totalHomeSqFt"
                  type="number"
                  value={homeOfficeSettings.totalHomeSqFt}
                  onChange={(e) => setHomeOfficeSettings({
                    ...homeOfficeSettings,
                    totalHomeSqFt: Number(e.target.value)
                  })}
                />
              </div>
              <div>
                <Label htmlFor="officeSqFt">Office Square Footage</Label>
                <Input
                  id="officeSqFt"
                  type="number"
                  value={homeOfficeSettings.officeSqFt}
                  onChange={(e) => setHomeOfficeSettings({
                    ...homeOfficeSettings,
                    officeSqFt: Number(e.target.value)
                  })}
                />
              </div>
              <div>
                <Label htmlFor="rentOrMortgageInterest">Rent or Mortgage Interest</Label>
                <Input
                  id="rentOrMortgageInterest"
                  type="number"
                  value={homeOfficeSettings.rentOrMortgageInterest}
                  onChange={(e) => setHomeOfficeSettings({
                    ...homeOfficeSettings,
                    rentOrMortgageInterest: Number(e.target.value)
                  })}
                />
              </div>
              <div>
                <Label htmlFor="utilities">Utilities</Label>
                <Input
                  id="utilities"
                  type="number"
                  value={homeOfficeSettings.utilities}
                  onChange={(e) => setHomeOfficeSettings({
                    ...homeOfficeSettings,
                    utilities: Number(e.target.value)
                  })}
                />
              </div>
              <div>
                <Label htmlFor="insurance">Insurance</Label>
                <Input
                  id="insurance"
                  type="number"
                  value={homeOfficeSettings.insurance}
                  onChange={(e) => setHomeOfficeSettings({
                    ...homeOfficeSettings,
                    insurance: Number(e.target.value)
                  })}
                />
              </div>
              <div>
                <Label htmlFor="repairsMaintenance">Repairs & Maintenance</Label>
                <Input
                  id="repairsMaintenance"
                  type="number"
                  value={homeOfficeSettings.repairsMaintenance}
                  onChange={(e) => setHomeOfficeSettings({
                    ...homeOfficeSettings,
                    repairsMaintenance: Number(e.target.value)
                  })}
                />
              </div>
              <div>
                <Label htmlFor="propertyTax">Property Tax</Label>
                <Input
                  id="propertyTax"
                  type="number"
                  value={homeOfficeSettings.propertyTax}
                  onChange={(e) => setHomeOfficeSettings({
                    ...homeOfficeSettings,
                    propertyTax: Number(e.target.value)
                  })}
                />
              </div>
              <div>
                <Label htmlFor="other">Other Expenses</Label>
                <Input
                  id="other"
                  type="number"
                  value={homeOfficeSettings.other}
                  onChange={(e) => setHomeOfficeSettings({
                    ...homeOfficeSettings,
                    other: Number(e.target.value)
                  })}
                />
              </div>
            </div>
            
            <Button onClick={handleSaveHomeOffice} disabled={isLoading}>
              <Save className="w-4 h-4 mr-2" />
              {isLoading ? 'Saving...' : 'Save Home Office Settings'}
            </Button>
          </Card>
        )}

        {/* Assets Tab */}
        {activeTab === 'assets' && (
          <Card className="p-6">
            <h2 className="text-xl font-semibold mb-4">Business Assets</h2>
            <p className="text-gray-600 mb-6">Add your business assets for Form 4562 depreciation calculations</p>
            
            {/* Add New Asset Form */}
            <div className="border rounded-lg p-4 mb-6 bg-gray-50">
              <h3 className="font-medium mb-4">Add New Asset</h3>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <Label htmlFor="assetDescription">Description</Label>
                  <Input
                    id="assetDescription"
                    value={newAsset.description}
                    onChange={(e) => setNewAsset({ ...newAsset, description: e.target.value })}
                    placeholder="e.g., MacBook Pro, Office Desk"
                  />
                </div>
                <div>
                  <Label htmlFor="assetDate">Date Placed in Service</Label>
                  <Input
                    id="assetDate"
                    type="date"
                    value={newAsset.datePlacedInService}
                    onChange={(e) => setNewAsset({ ...newAsset, datePlacedInService: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="assetCost">Cost</Label>
                  <Input
                    id="assetCost"
                    type="number"
                    value={newAsset.cost}
                    onChange={(e) => setNewAsset({ ...newAsset, cost: Number(e.target.value) })}
                  />
                </div>
                <div>
                  <Label htmlFor="assetBusinessUse">Business Use %</Label>
                  <Input
                    id="assetBusinessUse"
                    type="number"
                    min="0"
                    max="100"
                    value={newAsset.businessUsePercent}
                    onChange={(e) => setNewAsset({ ...newAsset, businessUsePercent: Number(e.target.value) })}
                  />
                </div>
                <div>
                  <Label htmlFor="assetCategory">Category</Label>
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
                  <Label htmlFor="assetMethod">Depreciation Method</Label>
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
              <Button onClick={handleAddAsset}>
                <Plus className="w-4 h-4 mr-2" />
                Add Asset
              </Button>
            </div>
            
            {/* Assets List */}
            {assets.length > 0 && (
              <div className="mb-6">
                <h3 className="font-medium mb-4">Your Assets ({assets.length})</h3>
                <div className="space-y-2">
                  {assets.map((asset) => (
                    <div key={asset.id} className="flex items-center justify-between p-3 border rounded-lg">
                      <div>
                        <div className="font-medium">{asset.description}</div>
                        <div className="text-sm text-gray-500">
                          ${asset.cost.toLocaleString()} • {asset.businessUsePercent}% business use • {asset.category}
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleRemoveAsset(asset.id)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            <Button onClick={handleSaveAssets} disabled={isLoading || assets.length === 0}>
              <Save className="w-4 h-4 mr-2" />
              {isLoading ? 'Saving...' : 'Save Assets'}
            </Button>
          </Card>
        )}

        {/* Tax Summary Tab */}
        {activeTab === 'taxSummary' && (
          <Card className="p-6">
            <h2 className="text-xl font-semibold mb-4">Tax Summary Settings</h2>
            <p className="text-gray-600 mb-6">Configure your tax summary for Schedule SE calculations</p>
            
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div>
                <Label htmlFor="scheduleCNetProfit">Schedule C Net Profit</Label>
                <Input
                  id="scheduleCNetProfit"
                  type="number"
                  value={taxSummary.scheduleCNetProfit}
                  onChange={(e) => setTaxSummary({
                    ...taxSummary,
                    scheduleCNetProfit: Number(e.target.value)
                  })}
                />
              </div>
              <div>
                <Label htmlFor="taxYear">Tax Year</Label>
                <Input
                  id="taxYear"
                  type="number"
                  value={taxSummary.taxYear}
                  onChange={(e) => setTaxSummary({
                    ...taxSummary,
                    taxYear: Number(e.target.value)
                  })}
                />
              </div>
              <div>
                <Label htmlFor="adjustments">Adjustments</Label>
                <Input
                  id="adjustments"
                  type="number"
                  value={taxSummary.adjustments}
                  onChange={(e) => setTaxSummary({
                    ...taxSummary,
                    adjustments: Number(e.target.value)
                  })}
                />
              </div>
            </div>
            
            <Button onClick={handleSaveTaxSummary} disabled={isLoading}>
              <Save className="w-4 h-4 mr-2" />
              {isLoading ? 'Saving...' : 'Save Tax Summary'}
            </Button>
          </Card>
        )}
      </div>
    </div>
  );
}
