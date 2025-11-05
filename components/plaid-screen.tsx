"use client";

import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Building2, CheckCircle, AlertCircle, Plus, Trash2 } from 'lucide-react';
import { auth } from '@/lib/firebase/client';

interface PlaidScreenProps {
  user: any;
  onBack: () => void;
  onConnect: () => void;
}

interface BankAccount {
  id: string;
  name: string;
  type: string;
  mask: string;
  balance: number;
  isConnected: boolean;
  lastSync: string;
}

export const PlaidScreen: React.FC<PlaidScreenProps> = ({ user, onBack, onConnect }) => {
  const [connectedAccounts, setConnectedAccounts] = useState<BankAccount[]>([]);
  const [pendingAccounts] = useState<BankAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingAccountId, setDeletingAccountId] = useState<string | null>(null);
  const [disconnectingPlaid, setDisconnectingPlaid] = useState(false);
  const [hasPlaidConnection, setHasPlaidConnection] = useState(false);

  // Fetch accounts and Plaid connection status from API
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);

        // Get Firebase auth token
        const currentUser = auth.currentUser;
        if (!currentUser) {
          console.error('No authenticated user found');
          setLoading(false);
          return;
        }

        const token = await currentUser.getIdToken();

        // Check Plaid connection status
        const plaidStatusResponse = await fetch('/api/plaid/items', {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        });
        if (plaidStatusResponse.ok) {
          const plaidStatus = await plaidStatusResponse.json();
          setHasPlaidConnection(plaidStatus.hasConnection || false);
        }

        // Fetch accounts with authentication
        const accountsResponse = await fetch('/api/database/accounts', {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        });
        if (accountsResponse.ok) {
          const data = await accountsResponse.json();
          console.log('📊 [Plaid Screen] Fetched accounts:', data);
          const accounts: BankAccount[] = (data.accounts || []).map((account: any) => ({
            id: account.account_id || account.id,
            name: account.name || 'Unknown Account',
            type: account.subtype || account.type || 'checking',
            mask: account.mask || '****',
            balance: 0, // Balance would need to be fetched separately
            isConnected: true,
            lastSync: account.updated_at ? 'Recently' : 'Never'
          }));
          console.log('✅ [Plaid Screen] Processed accounts:', accounts);
          setConnectedAccounts(accounts);
        } else {
          const errorData = await accountsResponse.json().catch(() => ({}));
          console.error('❌ [Plaid Screen] Failed to fetch accounts:', accountsResponse.status, errorData);
        }
      } catch (error) {
        console.error('Error fetching data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  const handleDeleteAccount = async (accountId: string) => {
    if (!window.confirm('Are you sure you want to delete this bank account? This will also delete all associated transactions. This action cannot be undone.')) {
      return;
    }

    try {
      setDeletingAccountId(accountId);
      const response = await fetch('/api/database/accounts', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ accountId }),
      });

      const result = await response.json();

      if (response.ok && result.success) {
        // Remove the account from the list
        setConnectedAccounts(prev => prev.filter(acc => acc.id !== accountId));
        alert('Bank account deleted successfully.');
      } else {
        alert(`Failed to delete account: ${result.error || result.details || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Error deleting account:', error);
      alert('Failed to delete account. Please try again.');
    } finally {
      setDeletingAccountId(null);
    }
  };

  const handleDisconnectPlaid = async () => {
    const confirmMessage = 'This will revoke access in Plaid and delete all imported data (accounts, transactions, receipts) for this bank connection. Continue?';
    if (!window.confirm(confirmMessage)) {
      return;
    }

    try {
      setDisconnectingPlaid(true);
      const response = await fetch('/api/plaid/items', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const result = await response.json();

      if (response.ok && result.success) {
        // Clear all accounts
        setConnectedAccounts([]);
        setHasPlaidConnection(false);
        alert(`Bank connection disconnected successfully. ${result.deletedCounts?.accounts || 0} accounts and ${result.deletedCounts?.transactions || 0} transactions deleted.`);
      } else {
        const errorMsg = result.details || result.error || 'Unknown error';
        alert(`Failed to disconnect bank: ${errorMsg}`);
      }
    } catch (error) {
      console.error('Error disconnecting Plaid:', error);
      alert('Failed to disconnect bank. Please try again.');
    } finally {
      setDisconnectingPlaid(false);
    }
  };

  return (
    <div className="min-h-screen bg-muted">
      {/* Header */}
      <div className="bg-background border-b border-border sticky top-0 z-50 shadow-sm">
        <div className="flex items-center justify-between p-6">
          <button
            onClick={onBack}
            className="w-12 h-12 bg-background border border-border rounded-lg flex items-center justify-center text-foreground hover:bg-muted transition-all duration-200 shadow-sm"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="text-center">
            <div className="h-8 w-24 bg-primary rounded-lg flex items-center justify-center mx-auto mb-2">
              <span className="text-primary-foreground font-medium text-sm">WriteOff</span>
            </div>
            <h1 className="text-xl font-medium text-foreground mb-1">
              Connected <span className="text-primary font-medium">Banks</span>
            </h1>
            <p className="text-muted-foreground">Manage your bank connections</p>
          </div>
          <div className="w-12"></div>
        </div>
      </div>

      <div className="p-6 pb-32">
        {/* Connect New Bank */}
        <Card className="p-6 bg-accent border-0 shadow-lg mb-6 text-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-white bg-opacity-20 rounded-lg flex items-center justify-center">
                <Plus className="w-6 h-6 text-white" />
              </div>
              <div>
                <h3 className="text-lg font-medium">Add New Bank Account</h3>
                <p className="text-accent/90 text-sm">Securely connect another bank for expense tracking</p>
              </div>
            </div>
            <div className="flex gap-2">
              {hasPlaidConnection && (
                <Button
                  onClick={handleDisconnectPlaid}
                  disabled={disconnectingPlaid}
                  variant="destructive"
                  className="bg-red-600 hover:bg-red-700 text-white"
                >
                  {disconnectingPlaid ? 'Disconnecting...' : 'Disconnect Plaid'}
                </Button>
              )}
              <Button
                onClick={onConnect}
                variant="secondary"
                className="bg-white text-accent hover:bg-accent/10"
              >
                Connect Bank
              </Button>
            </div>
          </div>
        </Card>

        {/* Connected Accounts */}
        {loading ? (
          <div className="mb-8">
            <div className="text-center py-12">
              <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
              <p className="text-muted-foreground">Loading accounts...</p>
            </div>
          </div>
        ) : connectedAccounts.length > 0 ? (
          <div className="mb-8">
            <h2 className="text-lg font-medium text-foreground mb-4">Connected Accounts</h2>
            <div className="space-y-4">
              {connectedAccounts.map((account) => (
                <Card key={account.id} className="p-6 bg-card border border-border shadow-lg">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center">
                        <Building2 className="w-6 h-6 text-primary" />
                      </div>
                      <div>
                        <h3 className="font-medium text-card-foreground">{account.name}</h3>
                        <p className="text-muted-foreground text-sm">
                          {account.type.charAt(0).toUpperCase() + account.type.slice(1)} •••• {account.mask}
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                          <CheckCircle className="w-4 h-4 text-primary" />
                          <span className="text-xs text-muted-foreground">Last synced {account.lastSync}</span>
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold text-card-foreground">
                        ${Math.abs(account.balance).toLocaleString()}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {account.type === 'credit' ? 'Outstanding' : 'Available'}
                      </p>
                      <div className="flex gap-2 mt-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-primary border-primary/20 hover:bg-primary/10"
                        >
                          Sync Now
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDeleteAccount(account.id)}
                          disabled={deletingAccountId === account.id}
                          className="text-destructive border-destructive/20 hover:bg-destructive/10 hover:text-destructive"
                        >
                          {deletingAccountId === account.id ? (
                            'Deleting...'
                          ) : (
                            <Trash2 className="w-4 h-4" />
                          )}
                        </Button>
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        ) : (
          <div className="mb-8">
            <div className="text-center py-12">
              <Building2 className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">No connected accounts</p>
            </div>
          </div>
        )}

        {/* Pending/Disconnected Accounts */}
        {pendingAccounts.length > 0 && (
          <div className="mb-8">
            <h2 className="text-lg font-medium text-foreground mb-4">Reconnection Required</h2>
            <div className="space-y-4">
              {pendingAccounts.map((account) => (
                <Card key={account.id} className="p-6 bg-card border border-orange-500/20 shadow-xl border-l-4 border-l-orange-500">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 bg-orange-500/20 rounded-xl flex items-center justify-center">
                        <AlertCircle className="w-6 h-6 text-orange-500" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-card-foreground">{account.name}</h3>
                        <p className="text-muted-foreground text-sm">
                          {account.type.charAt(0).toUpperCase() + account.type.slice(1)} •••• {account.mask}
                        </p>
                        <p className="text-orange-500 text-xs mt-1">Connection expired - please reconnect</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <Button
                        onClick={onConnect}
                        className="bg-orange-500 hover:bg-orange-600 text-white"
                      >
                        Reconnect
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* Benefits */}
        <Card className="p-6 bg-card border border-border shadow-xl">
          <h3 className="text-lg font-semibold text-card-foreground mb-4">Why Connect Your Bank?</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex items-start gap-3">
              <CheckCircle className="w-5 h-5 text-emerald-500 mt-0.5" />
              <div>
                <p className="font-medium text-card-foreground">Automatic Expense Tracking</p>
                <p className="text-sm text-muted-foreground">All business transactions imported automatically</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <CheckCircle className="w-5 h-5 text-emerald-500 mt-0.5" />
              <div>
                <p className="font-medium text-card-foreground">Smart Categorization</p>
                <p className="text-sm text-muted-foreground">AI-powered expense classification</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <CheckCircle className="w-5 h-5 text-emerald-500 mt-0.5" />
              <div>
                <p className="font-medium text-card-foreground">Real-time Deduction Tracking</p>
                <p className="text-sm text-muted-foreground">See tax savings as they happen</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <CheckCircle className="w-5 h-5 text-emerald-500 mt-0.5" />
              <div>
                <p className="font-medium text-card-foreground">Bank-level Security</p>
                <p className="text-sm text-muted-foreground">256-bit encryption, read-only access</p>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
};
