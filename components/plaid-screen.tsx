"use client";

import React, { useState, useEffect } from 'react';
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
  last_import_earliest_tx?: string | null;
  last_import_requested_start?: string | null;
  last_import_count?: number | null;
}

export const PlaidScreen: React.FC<PlaidScreenProps> = ({ user, onBack, onConnect }) => {
  const [connectedAccounts, setConnectedAccounts] = useState<BankAccount[]>([]);
  const [pendingAccounts] = useState<BankAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingAccountId, setDeletingAccountId] = useState<string | null>(null);
  const [syncingAccountId, setSyncingAccountId] = useState<string | null>(null);
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
            balance: account.balance ?? account.available_balance ?? account.current_balance ?? 0,
            isConnected: true,
            lastSync: account.updated_at ? 'Recently' : 'Never',
            last_import_earliest_tx: account.last_import_earliest_tx ?? null,
            last_import_requested_start: account.last_import_requested_start ?? null,
            last_import_count: account.last_import_count ?? null,
          }));
          console.log('✅ [Plaid Screen] Processed accounts:', accounts);
          setConnectedAccounts(accounts);

          if (data.metadata?.needsBalanceRefresh) {
            try {
              await fetch('/api/plaid/refresh-balances', {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${token}`,
                  'Content-Type': 'application/json',
                },
              });
              const refetch = await fetch('/api/database/accounts', {
                headers: {
                  'Authorization': `Bearer ${token}`,
                  'Content-Type': 'application/json',
                },
              });
              if (refetch.ok) {
                const refetchData = await refetch.json();
                const refreshedAccounts: BankAccount[] = (refetchData.accounts || []).map((account: any) => ({
                  id: account.account_id || account.id,
                  name: account.name || 'Unknown Account',
                  type: account.subtype || account.type || 'checking',
                  mask: account.mask || '****',
                  balance: account.balance ?? account.available_balance ?? account.current_balance ?? 0,
                  isConnected: true,
                  lastSync: account.updated_at ? 'Recently' : 'Never',
                  last_import_earliest_tx: account.last_import_earliest_tx ?? null,
                  last_import_requested_start: account.last_import_requested_start ?? null,
                  last_import_count: account.last_import_count ?? null,
                }));
                setConnectedAccounts(refreshedAccounts);
              }
            } catch (refreshErr) {
              console.warn('[Plaid Screen] Balance refresh failed:', refreshErr);
            }
          }
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

    const currentUser = auth.currentUser;
    if (!currentUser) {
      alert('Please sign in to delete an account.');
      return;
    }

    try {
      setDeletingAccountId(accountId);
      const token = await currentUser.getIdToken();
      const response = await fetch('/api/database/accounts', {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
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

    const currentUser = auth.currentUser;
    if (!currentUser) {
      alert('Please sign in to disconnect.');
      return;
    }

    try {
      setDisconnectingPlaid(true);
      const token = await currentUser.getIdToken();
      const response = await fetch('/api/plaid/items', {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
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

  const handleSyncNow = async (accountId: string) => {
    const currentUser = auth.currentUser;
    if (!currentUser) return;

    try {
      setSyncingAccountId(accountId);
      const token = await currentUser.getIdToken();

      await fetch('/api/plaid/sync-transactions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ userId: currentUser.uid, incremental: true }),
      });

      await fetch('/api/plaid/refresh-balances', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      const refetch = await fetch('/api/database/accounts', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      if (refetch.ok) {
        const refetchData = await refetch.json();
        const refreshedAccounts: BankAccount[] = (refetchData.accounts || []).map((account: any) => ({
          id: account.account_id || account.id,
          name: account.name || 'Unknown Account',
          type: account.subtype || account.type || 'checking',
          mask: account.mask || '****',
          balance: account.balance ?? account.available_balance ?? account.current_balance ?? 0,
          isConnected: true,
          lastSync: account.updated_at ? 'Recently' : 'Never'
        }));
        setConnectedAccounts(refreshedAccounts);
      }
    } catch (err) {
      console.warn('[Plaid Screen] Sync failed:', err);
      alert('Sync failed. Please try again.');
    } finally {
      setSyncingAccountId(null);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-background sticky top-0 z-10 border-b border-border/50 backdrop-blur-sm bg-background/95">
        <div className="max-w-3xl mx-auto px-4 md:px-6 py-3 sm:py-4">
          <div className="flex items-center gap-3">
            <Button onClick={onBack} variant="outline" size="sm" className="h-9 w-9 p-0">
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div>
              <h1 className="text-lg sm:text-xl font-semibold text-foreground">Connected Banks</h1>
              <p className="text-xs text-muted-foreground">Manage your bank connections</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 md:px-6 py-4 pb-32">
        {/* Connect New Bank */}
        <div className="rounded-lg border border-border bg-card p-5 mb-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <Plus className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h3 className="text-sm font-medium text-foreground">Add New Bank Account</h3>
                <p className="text-xs text-muted-foreground">Securely connect another bank for expense tracking</p>
              </div>
            </div>
            <div className="flex gap-2 w-full sm:w-auto">
              {hasPlaidConnection && (
                <Button
                  onClick={handleDisconnectPlaid}
                  disabled={disconnectingPlaid}
                  variant="outline"
                  size="sm"
                  className="text-xs text-destructive border-destructive/30 hover:bg-destructive/10"
                >
                  {disconnectingPlaid ? 'Disconnecting...' : 'Disconnect'}
                </Button>
              )}
              <Button
                onClick={onConnect}
                size="sm"
                className="text-xs flex-1 sm:flex-none"
              >
                <Plus className="w-3.5 h-3.5 mr-1.5" />
                Connect Bank
              </Button>
            </div>
          </div>
        </div>

        {/* Connected Accounts */}
        {loading ? (
          <div className="mb-6">
            <div className="rounded-lg border border-border bg-card p-8 text-center">
              <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <p className="text-xs text-muted-foreground">Loading accounts...</p>
            </div>
          </div>
        ) : connectedAccounts.length > 0 ? (
          <div className="mb-6">
            <h2 className="text-sm font-medium text-foreground mb-3">Connected Accounts</h2>
            {connectedAccounts.some(
              (a) =>
                a.last_import_earliest_tx &&
                a.last_import_requested_start &&
                a.last_import_earliest_tx > a.last_import_requested_start
            ) && (
              <div className="mb-3 rounded-lg border border-border bg-muted/50 p-3 text-xs text-muted-foreground">
                <p className="font-medium text-foreground mb-0.5">Transaction history from your bank</p>
                <p>
                  For at least one account, the bank provided transactions only from the date shown below. Older
                  history is not available via this connection. You can try &quot;Sync Now&quot; or reconnect the
                  bank to refresh.
                </p>
                <ul className="mt-1.5 list-disc list-inside space-y-0.5">
                  {connectedAccounts
                    .filter(
                      (a) =>
                        a.last_import_earliest_tx &&
                        a.last_import_requested_start &&
                        a.last_import_earliest_tx > a.last_import_requested_start
                    )
                    .map((a) => (
                      <li key={a.id}>
                        <span className="font-medium text-foreground">{a.name}</span>: from{' '}
                        {new Date(a.last_import_earliest_tx!).toLocaleDateString('en-US', {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                        })}{' '}
                        onward
                        {a.last_import_count != null ? ` (${a.last_import_count} transactions)` : ''}
                      </li>
                    ))}
                </ul>
              </div>
            )}
            <div className="space-y-2">
              {connectedAccounts.map((account) => (
                <div key={account.id} className="rounded-lg border border-border bg-card p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                        <Building2 className="w-4 h-4 text-primary" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-sm font-medium text-foreground truncate">{account.name}</h3>
                        <p className="text-xs text-muted-foreground">
                          {account.type.charAt(0).toUpperCase() + account.type.slice(1)} •••• {account.mask}
                        </p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <CheckCircle className="w-3 h-3 text-primary shrink-0" />
                          <span className="text-xs text-muted-foreground">Synced {account.lastSync}</span>
                        </div>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-semibold text-foreground tabular-nums">
                        ${Math.abs(account.balance).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {account.type === 'credit' ? 'Outstanding' : 'Available'}
                      </p>
                      <div className="flex gap-1.5 mt-1.5 justify-end">
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-xs h-7 px-2"
                          onClick={(e) => { e.stopPropagation(); handleSyncNow(account.id); }}
                          disabled={syncingAccountId === account.id}
                        >
                          {syncingAccountId === account.id ? 'Syncing...' : 'Sync'}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={(e) => { e.stopPropagation(); handleDeleteAccount(account.id); }}
                          disabled={deletingAccountId === account.id}
                          className="text-xs h-7 w-7 p-0 text-destructive border-destructive/20 hover:bg-destructive/10 hover:text-destructive"
                        >
                          {deletingAccountId === account.id ? (
                            <div className="w-3 h-3 border border-destructive border-t-transparent rounded-full animate-spin" />
                          ) : (
                            <Trash2 className="w-3.5 h-3.5" />
                          )}
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="mb-8">
            <div className="rounded-lg border border-border bg-card p-8 text-center">
              <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto mb-3">
                <Building2 className="w-6 h-6 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium text-foreground mb-1">No connected accounts</p>
              <p className="text-xs text-muted-foreground mb-4">Connect your bank to start tracking expenses automatically</p>
              <Button onClick={onConnect} size="sm" className="text-xs">
                <Plus className="w-3.5 h-3.5 mr-1.5" />
                Connect Your First Bank
              </Button>
            </div>
          </div>
        )}

        {/* Pending/Disconnected Accounts */}
        {pendingAccounts.length > 0 && (
          <div className="mb-6">
            <h2 className="text-sm font-medium text-foreground mb-3">Reconnection Required</h2>
            <div className="space-y-2">
              {pendingAccounts.map((account) => (
                <div key={account.id} className="rounded-lg border border-amber-500/30 bg-card p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0">
                        <AlertCircle className="w-4 h-4 text-amber-500" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-sm font-medium text-foreground truncate">{account.name}</h3>
                        <p className="text-xs text-muted-foreground">
                          {account.type.charAt(0).toUpperCase() + account.type.slice(1)} •••• {account.mask}
                        </p>
                        <p className="text-xs text-amber-500 mt-0.5">Connection expired — please reconnect</p>
                      </div>
                    </div>
                    <Button onClick={onConnect} size="sm" className="text-xs shrink-0">
                      Reconnect
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Benefits */}
        <div className="rounded-lg border border-border bg-card p-5">
          <h3 className="text-sm font-medium text-foreground mb-3">Why Connect Your Bank?</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="flex items-start gap-2.5">
              <CheckCircle className="w-4 h-4 text-primary mt-0.5 shrink-0" />
              <div>
                <p className="text-xs font-medium text-foreground">Automatic Expense Tracking</p>
                <p className="text-xs text-muted-foreground">All business transactions imported automatically</p>
              </div>
            </div>
            <div className="flex items-start gap-2.5">
              <CheckCircle className="w-4 h-4 text-primary mt-0.5 shrink-0" />
              <div>
                <p className="text-xs font-medium text-foreground">Smart Categorization</p>
                <p className="text-xs text-muted-foreground">AI-powered expense classification</p>
              </div>
            </div>
            <div className="flex items-start gap-2.5">
              <CheckCircle className="w-4 h-4 text-primary mt-0.5 shrink-0" />
              <div>
                <p className="text-xs font-medium text-foreground">Real-time Deduction Tracking</p>
                <p className="text-xs text-muted-foreground">See tax savings as they happen</p>
              </div>
            </div>
            <div className="flex items-start gap-2.5">
              <CheckCircle className="w-4 h-4 text-primary mt-0.5 shrink-0" />
              <div>
                <p className="text-xs font-medium text-foreground">Bank-level Security</p>
                <p className="text-xs text-muted-foreground">256-bit encryption, read-only access</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
