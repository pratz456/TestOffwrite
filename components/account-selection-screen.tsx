"use client";

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckCircle, CreditCard, Building2, AlertCircle } from 'lucide-react';
import { auth } from '@/lib/firebase/client';

interface PlaidAccount {
  account_id: string;
  name: string;
  official_name?: string;
  type: string;
  subtype: string;
  mask?: string;
}

interface AccountSelectionScreenProps {
  accounts: PlaidAccount[];
  onAccountSelected: (accountId: string) => void;
  onBack: () => void;
}

export const AccountSelectionScreen: React.FC<AccountSelectionScreenProps> = ({ 
  accounts, 
  onAccountSelected, 
  onBack 
}) => {
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');
  const [loading, setLoading] = useState(false);

  const getAccountIcon = (type: string, subtype: string) => {
    if (type === 'credit' || subtype === 'credit card') {
      return <CreditCard className="w-5 h-5 text-blue-600" />;
    }
    if (type === 'depository' || subtype === 'checking') {
      return <Building2 className="w-5 h-5 text-green-600" />;
    }
    return <Building2 className="w-5 h-5 text-gray-600" />;
  };

  const getAccountTypeLabel = (type: string, subtype: string) => {
    if (subtype === 'checking') return 'Checking Account';
    if (subtype === 'credit card') return 'Credit Card';
    if (subtype === 'savings') return 'Savings Account';
    return `${type} Account`;
  };

  const handleSelectAccount = async () => {
    if (!selectedAccountId) return;
    
    setLoading(true);
    try {
      onAccountSelected(selectedAccountId);
    } catch (error) {
      console.error('Error selecting account:', error);
    } finally {
      setLoading(false);
    }
  };

  // Auto-select the most likely account (checking or credit card)
  useEffect(() => {
    if (accounts.length > 0 && !selectedAccountId) {
      const checkingAccount = accounts.find(acc => acc.subtype === 'checking');
      const creditCardAccount = accounts.find(acc => acc.subtype === 'credit card');
      const defaultAccount = checkingAccount || creditCardAccount || accounts[0];
      
      if (defaultAccount) {
        setSelectedAccountId(defaultAccount.account_id);
      }
    }
  }, [accounts, selectedAccountId]);

  return (
    <div className="min-h-screen bg-muted">
      <div className="bg-white border-b border-border sticky top-0 z-50 shadow-sm">
        <div className="flex items-center justify-between p-4 max-w-4xl mx-auto">
          <button 
            onClick={onBack}
            className="w-10 h-10 bg-white border border-border rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-all duration-200 shadow-sm"
          >
            ←
          </button>
          <div className="text-center">
            <div className="h-6 w-20 bg-primary rounded-lg flex items-center justify-center mx-auto mb-1">
              <span className="text-white font-medium text-xs">WriteOff</span>
            </div>
            <h1 className="text-lg font-medium text-foreground">Select Your <span className="text-primary font-medium">Account</span></h1>
            <p className="text-xs text-muted-foreground">Choose which account to analyze for <span className="font-medium text-primary">tax deductions</span></p>
          </div>
          <div className="w-10"></div>
        </div>
      </div>

      <div className="p-4 pb-20 max-w-4xl mx-auto">
        <div className="mb-6">
          <div className="flex items-center justify-center gap-2 mb-3">
            <div className="w-6 h-6 bg-primary rounded-lg flex items-center justify-center text-white font-medium text-xs">✓</div>
            <div className="w-12 h-1 bg-primary rounded-full"></div>
            <div className="w-6 h-6 bg-primary rounded-lg flex items-center justify-center text-white font-medium text-xs">2</div>
            <div className="w-12 h-1 bg-muted rounded-full"></div>
            <div className="w-6 h-6 bg-muted rounded-lg flex items-center justify-center text-muted-foreground font-medium text-xs">3</div>
          </div>
          <p className="text-center text-muted-foreground text-sm">
            <span className="font-medium text-primary">Step 2 of 3:</span> Account Selection
          </p>
        </div>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-lg">Choose Your Account</CardTitle>
            <p className="text-sm text-muted-foreground">
              Select the account you use most for business expenses. We'll analyze transactions from this account for tax deductions.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            {accounts.map((account) => (
              <div
                key={account.account_id}
                className={`p-4 border-2 rounded-lg cursor-pointer transition-all duration-200 ${
                  selectedAccountId === account.account_id
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/50 hover:bg-muted/50'
                }`}
                onClick={() => setSelectedAccountId(account.account_id)}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                    selectedAccountId === account.account_id
                      ? 'border-primary bg-primary'
                      : 'border-muted-foreground'
                  }`}>
                    {selectedAccountId === account.account_id && (
                      <div className="w-2 h-2 bg-white rounded-full"></div>
                    )}
                  </div>
                  
                  <div className="flex items-center gap-3 flex-1">
                    {getAccountIcon(account.type, account.subtype)}
                    <div className="flex-1">
                      <h3 className="font-medium text-foreground">
                        {account.name || account.official_name || 'Account'}
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        {getAccountTypeLabel(account.type, account.subtype)}
                        {account.mask && ` •••• ${account.mask}`}
                      </p>
                    </div>
                  </div>
                  
                  {selectedAccountId === account.account_id && (
                    <CheckCircle className="w-5 h-5 text-primary" />
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-blue-600 mt-0.5" />
            <div>
              <h4 className="font-medium text-blue-900 mb-1">Which account should I choose?</h4>
              <div className="text-sm text-blue-800 space-y-1">
                <p>• <strong>Credit Card:</strong> Best for business expenses and purchases</p>
                <p>• <strong>Checking Account:</strong> Good for business transactions and expenses</p>
                <p>• <strong>Avoid Savings:</strong> Usually has no transaction activity</p>
              </div>
            </div>
          </div>
        </div>

        <div className="flex gap-3">
          <Button
            onClick={handleSelectAccount}
            disabled={!selectedAccountId || loading}
            className="flex-1 h-12 bg-primary hover:bg-primary-hover text-white rounded-lg transition-all duration-200 flex items-center justify-center gap-3 disabled:opacity-50"
          >
            {loading ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                <span>Processing...</span>
              </>
            ) : (
              <>
                <CheckCircle className="w-4 h-4" />
                <span>Continue with Selected Account</span>
              </>
            )}
          </Button>
          
          <Button
            onClick={onBack}
            variant="outline"
            className="h-12 px-6 bg-background hover:bg-muted text-foreground border border-border hover:border-primary/30 rounded-lg transition-all duration-200"
          >
            Back
          </Button>
        </div>
      </div>
    </div>
  );
};

