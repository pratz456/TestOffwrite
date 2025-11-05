"use client";

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ArrowLeft, Building2, CheckCircle, AlertCircle, CreditCard, Smartphone, DollarSign, Calendar, Plus, Trash2 } from 'lucide-react';
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
          const accounts: BankConnection[] = (data.accounts || []).map((account: any) => ({
            id: account.account_id || account.id,
            bankName: account.name || 'Unknown Bank',
            accountType: `${account.subtype || account.type || 'Account'}`,
            accountNumber: account.mask ? `****${account.mask}` : '****',
            isConnected: true,
            lastSync: account.updated_at ? new Date(account.updated_at.seconds * 1000 || account.updated_at).toISOString() : new Date().toISOString(),
            balance: 0, // Balance would need to be fetched separately
            transactionCount: 0, // Transaction count would need to be calculated
            status: 'active' as const
          }));
          console.log('✅ [Banks Detail] Processed accounts:', accounts);
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
                      <div className="flex items-start gap-3">
                        {getStatusIcon(connection.status)}
                        <div>
                          <h4 className="font-medium text-slate-900">{connection.bankName}</h4>
                          <p className="text-sm text-slate-600">{connection.accountType} • {connection.accountNumber}</p>
                          <div className="flex items-center gap-4 mt-2">
                            <span className="text-xs text-slate-500">
                              Last sync: {formatLastSync(connection.lastSync)}
                            </span>
                            {connection.balance !== undefined && (
                              <span className={`text-xs font-medium ${
                                connection.balance >= 0 ? 'text-green-600' : 'text-red-600'
                              }`}>
                                Balance: ${connection.balance.toLocaleString()}
                              </span>
                            )}
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
                          <Button variant="outline" size="sm">
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
