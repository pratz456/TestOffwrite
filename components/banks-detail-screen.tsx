"use client";

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ArrowLeft, Building2, CheckCircle, AlertCircle, CreditCard, Smartphone, DollarSign, Calendar, Plus, Trash2, RefreshCw } from 'lucide-react';
import { auth } from '@/lib/firebase/client';

interface BankConnection {
  id: string;
  bankName: string;
  accountType: string;
  accountNumber: string;
  isConnected: boolean;
  lastSync: string;
  balance?: number;
  transactionCount: number;
  status: 'active' | 'error' | 'pending';
}

interface BanksDetailScreenProps {
  user: {
    id: string;
    email?: string;
    user_metadata?: {
      name?: string;
    };
  };
  onBack: () => void;
  onConnectBank: () => void;
  bankConnected?: boolean;
}

export const BanksDetailScreen: React.FC<BanksDetailScreenProps> = ({
  user,
  onBack,
  onConnectBank,
  bankConnected = false
}) => {
  const [selectedFilter, setSelectedFilter] = useState<'all' | 'active' | 'error'>('all');
  const [bankConnections, setBankConnections] = useState<BankConnection[]>([]);
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
          console.log('📊 [Banks Detail] Fetched accounts:', data);

          // First, refresh balances from Plaid to get the latest data
          try {
            console.log('🔄 [Banks Detail] Refreshing balances from Plaid...');
            const refreshResponse = await fetch('/api/plaid/refresh-balances', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
              },
            });

            if (refreshResponse.ok) {
              const refreshData = await refreshResponse.json();
              console.log('✅ [Banks Detail] Balance refresh response:', refreshData);
              console.log(`✅ [Banks Detail] Updated ${refreshData.updated || 0} account(s) with fresh balances`);

              if (refreshData.skipped > 0) {
                console.warn(`⚠️ [Banks Detail] ${refreshData.skipped} account(s) were skipped during refresh:`, refreshData.skippedAccounts);
              }

              // Re-fetch accounts to get updated balances
              const refreshedAccountsResponse = await fetch('/api/database/accounts', {
                headers: {
                  'Authorization': `Bearer ${token}`,
                  'Content-Type': 'application/json',
                },
              });
              if (refreshedAccountsResponse.ok) {
                const refreshedData = await refreshedAccountsResponse.json();
                console.log(`✅ [Banks Detail] Fetched ${refreshedData.accounts?.length || 0} accounts after balance refresh`);

                // Check if balances were actually updated
                const accountsWithBalances = refreshedData.accounts.filter((acc: any) =>
                  acc.balance !== undefined && acc.balance !== null
                );
                console.log(`✅ [Banks Detail] ${accountsWithBalances.length} account(s) now have balance data`);

                data.accounts = refreshedData.accounts;
              } else {
                const errorText = await refreshedAccountsResponse.text().catch(() => 'Unknown error');
                console.warn('⚠️ [Banks Detail] Failed to fetch accounts after refresh:', refreshedAccountsResponse.status, errorText);
                // Continue with stored data if refresh fails
              }
            } else {
              const errorText = await refreshResponse.text().catch(() => '');
              let errorData;
              try {
                errorData = JSON.parse(errorText);
              } catch {
                errorData = { error: errorText || 'Unknown error' };
              }
              console.error('❌ [Banks Detail] Balance refresh failed:', refreshResponse.status, errorData);
              console.error('❌ [Banks Detail] Error details:', {
                status: refreshResponse.status,
                error: errorData.error,
                error_code: errorData.error_code,
                error_message: errorData.error_message
              });
              // Continue with stored data if refresh fails
            }
          } catch (refreshError: any) {
            console.warn('⚠️ [Banks Detail] Failed to refresh balances, using stored data:', refreshError?.message || refreshError);
            // Continue with stored data if refresh fails
          }

          const accounts: BankConnection[] = (data.accounts || []).map((account: any) => {
            // Calculate balance based on account type
            let displayBalance = 0;
            const isCreditCard = account.type === 'credit' || account.subtype === 'credit card';

            if (isCreditCard) {
              // For credit cards: show available credit
              // balance field should already contain the calculated available credit
              displayBalance = account.balance ?? account.available_balance ?? 0;
            } else {
              // For depository accounts: show available balance
              displayBalance = account.balance ?? account.available_balance ?? account.current_balance ?? 0;
            }

            return {
              id: account.account_id || account.id,
              bankName: account.name || 'Unknown Bank',
              accountType: `${account.subtype || account.type || 'Account'}`,
              accountNumber: account.mask ? `****${account.mask}` : '****',
              isConnected: true,
              lastSync: account.updated_at ? new Date(account.updated_at.seconds * 1000 || account.updated_at).toISOString() : new Date().toISOString(),
              balance: displayBalance,
              transactionCount: 0, // Transaction count would need to be calculated
              status: 'active' as const
            };
          });
          console.log('✅ [Banks Detail] Processed accounts with balances:', accounts);
          setBankConnections(accounts);
        } else {
          const errorData = await accountsResponse.json().catch(() => ({}));
          console.error('❌ [Banks Detail] Failed to fetch accounts:', accountsResponse.status, errorData);
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

      // Get Firebase auth token
      const currentUser = auth.currentUser;
      if (!currentUser) {
        console.error('No authenticated user found');
        return;
      }

      const token = await currentUser.getIdToken();

      const response = await fetch('/api/database/accounts', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ accountId }),
      });

      const result = await response.json();

      if (response.ok && result.success) {
        // Remove the account from the list
        setBankConnections(prev => prev.filter(acc => acc.id !== accountId));
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
    if (!confirm('Are you sure you want to disconnect all Plaid connections? This will remove all connected bank accounts.')) {
      return;
    }

    try {
      setDisconnectingPlaid(true);

      // Get Firebase auth token
      const currentUser = auth.currentUser;
      if (!currentUser) {
        console.error('No authenticated user found');
        return;
      }

      const token = await currentUser.getIdToken();

      const response = await fetch('/api/plaid/items', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
      });

      const result = await response.json();

      if (response.ok && result.success) {
        // Clear all accounts
        setBankConnections([]);
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

  const filteredConnections = bankConnections.filter(connection => {
    if (selectedFilter === 'active') return connection.status === 'active';
    if (selectedFilter === 'error') return connection.status === 'error';
    return true;
  });

  const activeConnections = bankConnections.filter(c => c.status === 'active').length;
  const totalBalance = bankConnections
    .filter(c => c.status === 'active' && c.balance)
    .reduce((sum, c) => sum + (c.balance || 0), 0);
  const totalTransactions = bankConnections
    .filter(c => c.status === 'active')
    .reduce((sum, c) => sum + c.transactionCount, 0);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'active':
        return <CheckCircle className="w-5 h-5 text-green-600" />;
      case 'error':
        return <AlertCircle className="w-5 h-5 text-red-600" />;
      case 'pending':
        return <div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />;
      default:
        return <Building2 className="w-5 h-5 text-gray-400" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'border-l-green-500 bg-green-50';
      case 'error':
        return 'border-l-red-500 bg-red-50';
      case 'pending':
        return 'border-l-blue-500 bg-blue-50';
      default:
        return 'border-l-gray-500 bg-gray-50';
    }
  };

  const formatLastSync = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);

    if (diffHours < 1) return 'Less than an hour ago';
    if (diffHours < 24) return `${diffHours} hours ago`;
    if (diffDays === 1) return 'Yesterday';
    return `${diffDays} days ago`;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
      {/* Header */}
      <div className="bg-white border-b border-blue-100 sticky top-0 z-50 shadow-sm">
        <div className="max-w-6xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <Button onClick={onBack} variant="outline" size="sm" className="gap-2">
                <ArrowLeft className="w-4 h-4" />
                Back
              </Button>
              <div>
                <h1 className="text-xl font-semibold text-slate-900">Connected Banks</h1>
                <p className="text-sm text-slate-600">Manage your bank connections and sync settings</p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  try {
                    setLoading(true);
                    const currentUser = auth.currentUser;
                    if (!currentUser) return;

                    const token = await currentUser.getIdToken();
                    console.log('🔄 [Banks Detail] Refreshing all balances...');
                    const refreshResponse = await fetch('/api/plaid/refresh-balances', {
                      method: 'POST',
                      headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json',
                      },
                    });

                    if (refreshResponse.ok) {
                      const refreshData = await refreshResponse.json();
                      console.log('✅ [Banks Detail] Refreshed balances:', refreshData);

                      // Re-fetch accounts to get updated balances
                      const refreshedAccountsResponse = await fetch('/api/database/accounts', {
                        headers: {
                          'Authorization': `Bearer ${token}`,
                          'Content-Type': 'application/json',
                        },
                      });
                      if (refreshedAccountsResponse.ok) {
                        const refreshedData = await refreshedAccountsResponse.json();
                        const accounts: BankConnection[] = (refreshedData.accounts || []).map((account: any) => {
                          let displayBalance = 0;
                          const isCreditCard = account.type === 'credit' || account.subtype === 'credit card';

                          if (isCreditCard) {
                            displayBalance = account.balance ?? account.available_balance ?? 0;
                          } else {
                            displayBalance = account.balance ?? account.available_balance ?? account.current_balance ?? 0;
                          }

                          return {
                            id: account.account_id || account.id,
                            bankName: account.name || 'Unknown Bank',
                            accountType: `${account.subtype || account.type || 'Account'}`,
                            accountNumber: account.mask ? `****${account.mask}` : '****',
                            isConnected: true,
                            lastSync: account.updated_at ? new Date(account.updated_at.seconds * 1000 || account.updated_at).toISOString() : new Date().toISOString(),
                            balance: displayBalance,
                            transactionCount: 0,
                            status: 'active' as const
                          };
                        });
                        setBankConnections(accounts);
                        alert(`Successfully refreshed balances for ${refreshData.updated || 0} account(s)`);
                      }
                    } else {
                      const errorData = await refreshResponse.json().catch(() => ({}));
                      console.error('❌ [Banks Detail] Failed to refresh balances:', errorData);
                      alert('Failed to refresh balances. Please try again.');
                    }
                  } catch (error: any) {
                    console.error('❌ [Banks Detail] Error refreshing balances:', error);
                    alert('Error refreshing balances. Please try again.');
                  } finally {
                    setLoading(false);
                  }
                }}
                disabled={loading}
                className="gap-2"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                {loading ? 'Refreshing...' : 'Refresh Balances'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={async (e) => {
                  e.preventDefault();
                  e.stopPropagation();

                  if (!confirm('This will re-sync all transactions with maximum date range (2 years). This may take a few minutes. Continue?')) {
                    return;
                  }

                  const currentUser = auth.currentUser;
                  if (!currentUser) {
                    alert('Please log in to sync transactions');
                    return;
                  }

                  try {
                    setLoading(true);
                    console.log('🔄 [Banks Detail] Starting transaction sync...');

                    const token = await currentUser.getIdToken(true); // Force refresh token
                    console.log('🔄 [Banks Detail] Got auth token, calling sync API...');

                    const syncResponse = await fetch('/api/plaid/sync-transactions', {
                      method: 'POST',
                      headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json',
                      },
                      body: JSON.stringify({
                        userId: currentUser.uid,
                        import_timeframe: '2years'
                      }),
                    });

                    console.log('📡 [Banks Detail] Sync response status:', syncResponse.status);

                    if (syncResponse.ok) {
                      const syncData = await syncResponse.json();
                      console.log('✅ [Banks Detail] Transaction sync completed:', syncData);
                      alert(`✅ Successfully synced ${syncData.transactions_saved || 0} transactions!\n\nThe page will reload to show updated data.`);
                      setTimeout(() => {
                        window.location.reload();
                      }, 1500);
                    } else {
                      const errorData = await syncResponse.json().catch(() => ({}));
                      console.error('❌ [Banks Detail] Failed to sync transactions:', errorData);
                      const errorMessage = errorData.error || errorData.details || `HTTP ${syncResponse.status}: ${syncResponse.statusText}`;
                      alert(`❌ Failed to sync transactions:\n\n${errorMessage}\n\nPlease check the console for more details.`);
                    }
                  } catch (error: any) {
                    console.error('❌ [Banks Detail] Error syncing transactions:', error);
                    alert(`❌ Error syncing transactions:\n\n${error.message || 'Unknown error'}\n\nPlease check the console for more details.`);
                  } finally {
                    setLoading(false);
                  }
                }}
                disabled={loading}
                className="gap-2"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                {loading ? 'Syncing...' : 'Re-sync Transactions'}
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto p-6">
        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <Card className="p-6 bg-white border-0 shadow-xl">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center">
                <Building2 className="w-6 h-6 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-slate-600">Active Connections</p>
                <p className="text-2xl font-bold text-slate-900">{activeConnections}</p>
              </div>
            </div>
          </Card>

          <Card className="p-6 bg-white border-0 shadow-xl">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center">
                <DollarSign className="w-6 h-6 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-slate-600">Total Balance</p>
                <p className={`text-2xl font-bold ${totalBalance >= 0 ? 'text-slate-900' : 'text-red-600'}`}>
                  ${totalBalance.toLocaleString()}
                </p>
              </div>
            </div>
          </Card>

          <Card className="p-6 bg-white border-0 shadow-xl">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center">
                <CreditCard className="w-6 h-6 text-purple-600" />
              </div>
              <div>
                <p className="text-sm text-slate-600">Synced Transactions</p>
                <p className="text-2xl font-bold text-slate-900">{totalTransactions}</p>
              </div>
            </div>
          </Card>

          <Card className="p-6 bg-white border-0 shadow-xl">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-orange-100 rounded-xl flex items-center justify-center">
                <Calendar className="w-6 h-6 text-orange-600" />
              </div>
              <div>
                <p className="text-sm text-slate-600">Last Sync</p>
                <p className="text-lg font-bold text-slate-900">Today</p>
              </div>
            </div>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Bank Connections List */}
          <div className="lg:col-span-2">
            <Card className="p-6 bg-white border-0 shadow-xl">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-semibold text-slate-900">Bank Accounts</h3>
                <div className="flex gap-3">
                  <select
                    value={selectedFilter}
                    onChange={(e) => setSelectedFilter(e.target.value as any)}
                    className="px-3 py-2 border border-gray-300 rounded-md text-sm"
                  >
                    <option value="all">All Accounts</option>
                    <option value="active">Active Only</option>
                    <option value="error">Issues Only</option>
                  </select>
                  {hasPlaidConnection && (
                    <Button
                      onClick={handleDisconnectPlaid}
                      disabled={disconnectingPlaid}
                      variant="destructive"
                      className="gap-2 bg-red-600 hover:bg-red-700"
                    >
                      {disconnectingPlaid ? 'Disconnecting...' : 'Disconnect Plaid'}
                    </Button>
                  )}
                  <Button onClick={onConnectBank} className="gap-2 bg-blue-600 hover:bg-blue-700">
                    <Plus className="w-4 h-4" />
                    Connect Bank
                  </Button>
                </div>
              </div>

              <div className="space-y-4">
                {filteredConnections.map((connection) => (
                  <div
                    key={connection.id}
                    className={`p-4 rounded-lg border-l-4 ${getStatusColor(connection.status)}`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-3 flex-1">
                        {getStatusIcon(connection.status)}
                        <div className="flex-1">
                          <div className="flex items-start justify-between">
                            <div>
                              <h4 className="font-medium text-slate-900">{connection.bankName}</h4>
                              <p className="text-sm text-slate-600">{connection.accountType} • {connection.accountNumber}</p>
                            </div>
                            <div className="text-right ml-4">
                              {connection.balance !== undefined && connection.balance !== null ? (
                                <>
                                  <div className={`text-lg font-bold ${
                                    connection.balance >= 0 ? 'text-green-600' : 'text-red-600'
                                  }`}>
                                    ${Math.abs(connection.balance).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                  </div>
                                  <div className="text-xs text-slate-500 mt-1">
                                    {connection.accountType?.toLowerCase().includes('credit')
                                      ? 'Available Credit'
                                      : connection.balance < 0
                                        ? 'Balance Owed'
                                        : 'Available Balance'}
                                  </div>
                                </>
                              ) : (
                                <>
                                  <div className="text-lg font-bold text-slate-400">
                                    $0.00
                                  </div>
                                  <div className="text-xs text-slate-400 mt-1">
                                    Sync to update
                                  </div>
                                </>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-4 mt-2">
                            <span className="text-xs text-slate-500">
                              Last sync: {formatLastSync(connection.lastSync)}
                            </span>
                            <span className="text-xs text-slate-500">
                              {connection.transactionCount} transactions
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        {connection.status === 'error' ? (
                          <Button variant="outline" size="sm" className="text-red-600 border-red-200">
                            Fix Connection
                          </Button>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={async () => {
                              try {
                                const currentUser = auth.currentUser;
                                if (!currentUser) return;

                                const token = await currentUser.getIdToken();
                                const refreshResponse = await fetch('/api/plaid/refresh-balances', {
                                  method: 'POST',
                                  headers: {
                                    'Authorization': `Bearer ${token}`,
                                    'Content-Type': 'application/json',
                                  },
                                });

                                if (refreshResponse.ok) {
                                  // Reload accounts after refresh
                                  const accountsResponse = await fetch('/api/database/accounts', {
                                    headers: {
                                      'Authorization': `Bearer ${token}`,
                                      'Content-Type': 'application/json',
                                    },
                                  });
                                  if (accountsResponse.ok) {
                                    const data = await accountsResponse.json();
                                    const accounts: BankConnection[] = (data.accounts || []).map((account: any) => {
                                      // Calculate balance based on account type
                                      let displayBalance = 0;
                                      const isCreditCard = account.type === 'credit' || account.subtype === 'credit card';

                                      if (isCreditCard) {
                                        // For credit cards: show available credit
                                        displayBalance = account.balance ?? account.available_balance ?? 0;
                                      } else {
                                        // For depository accounts: show available balance
                                        displayBalance = account.balance ?? account.available_balance ?? account.current_balance ?? 0;
                                      }

                                      return {
                                        id: account.account_id || account.id,
                                        bankName: account.name || 'Unknown Bank',
                                        accountType: `${account.subtype || account.type || 'Account'}`,
                                        accountNumber: account.mask ? `****${account.mask}` : '****',
                                        isConnected: true,
                                        lastSync: account.updated_at ? new Date(account.updated_at.seconds * 1000 || account.updated_at).toISOString() : new Date().toISOString(),
                                        balance: displayBalance,
                                        transactionCount: 0,
                                        status: 'active' as const
                                      };
                                    });
                                    setBankConnections(accounts);
                                  }
                                }
                              } catch (error) {
                                console.error('Error syncing balances:', error);
                              }
                            }}
                          >
                            Sync Now
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDeleteAccount(connection.id)}
                          disabled={deletingAccountId === connection.id}
                          className="text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700"
                        >
                          {deletingAccountId === connection.id ? (
                            'Deleting...'
                          ) : (
                            <>
                              <Trash2 className="w-4 h-4 mr-1" />
                              Delete
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {loading ? (
                <div className="text-center py-12">
                  <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                  <p className="text-slate-500">Loading accounts...</p>
                </div>
              ) : filteredConnections.length === 0 ? (
                <div className="text-center py-12">
                  <Building2 className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                  <p className="text-slate-500">No bank connections found</p>
                  <Button onClick={onConnectBank} className="mt-4 gap-2">
                    <Plus className="w-4 h-4" />
                    Connect Your First Bank
                  </Button>
                </div>
              ) : null}
            </Card>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Quick Actions */}
            <Card className="p-6 bg-white border-0 shadow-xl">
              <h3 className="text-lg font-semibold text-slate-900 mb-4">Quick Actions</h3>
              <div className="space-y-3">
                <Button onClick={onConnectBank} variant="outline" className="w-full justify-start gap-2">
                  <Plus className="w-4 h-4" />
                  Add Bank Account
                </Button>
                <Button variant="outline" className="w-full justify-start gap-2">
                  <CheckCircle className="w-4 h-4" />
                  Sync All Accounts
                </Button>
                <Button variant="outline" className="w-full justify-start gap-2">
                  <AlertCircle className="w-4 h-4" />
                  Check for Issues
                </Button>
              </div>
            </Card>

            {/* Security Info */}
            <Card className="p-6 bg-white border-0 shadow-xl">
              <h3 className="text-lg font-semibold text-slate-900 mb-4">Security & Privacy</h3>
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-600" />
                  <span className="text-sm text-slate-700">Bank-level encryption</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-600" />
                  <span className="text-sm text-slate-700">Read-only access</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-600" />
                  <span className="text-sm text-slate-700">No credential storage</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-600" />
                  <span className="text-sm text-slate-700">SOC 2 certified</span>
                </div>
              </div>
              <p className="text-xs text-slate-500 mt-4">
                Your banking credentials are never stored. We use Plaid for secure, read-only access to your accounts.
              </p>
            </Card>

            {/* Sync Settings */}
            <Card className="p-6 bg-gradient-to-br from-blue-600 to-blue-700 border-0 shadow-xl text-white">
              <div className="mb-4">
                <h3 className="text-lg font-semibold mb-2">🔄 Auto-Sync</h3>
                <p className="text-sm text-blue-100">
                  Your transactions are automatically synced every 6 hours to keep your expense tracking up to date.
                </p>
              </div>
              <Button size="sm" variant="secondary" className="w-full">
                Sync Settings
              </Button>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
};
