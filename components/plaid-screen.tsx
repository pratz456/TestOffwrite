"use client";

import React, { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Building2, CheckCircle, AlertCircle, Plus } from 'lucide-react';

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
  const [connectedAccounts] = useState<BankAccount[]>([
    {
      id: '1',
      name: 'Chase Business Complete',
      type: 'checking',
      mask: '1234',
      balance: 15420.50,
      isConnected: true,
      lastSync: '2 hours ago'
    },
    {
      id: '2',
      name: 'American Express Business',
      type: 'credit',
      mask: '5678',
      balance: -2340.25,
      isConnected: true,
      lastSync: '1 day ago'
    }
  ]);

  const [pendingAccounts] = useState<BankAccount[]>([
    {
      id: '3',
      name: 'Wells Fargo Business',
      type: 'checking',
      mask: '9876',
      balance: 0,
      isConnected: false,
      lastSync: 'Never'
    }
  ]);

  return (
    <div className="min-h-screen bg-muted">
      {/* Header */}
      <div className="bg-white border-b border-border sticky top-0 z-50 shadow-sm">
        <div className="flex items-center justify-between p-6">
          <button 
            onClick={onBack}
            className="w-12 h-12 bg-white border border-border rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-all duration-200 shadow-sm"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="text-center">
            <div className="h-8 w-24 bg-primary rounded-lg flex items-center justify-center mx-auto mb-2">
              <span className="text-white font-medium text-sm">WriteOff</span>
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
            <Button
              onClick={onConnect}
              variant="secondary"
              className="bg-white text-accent hover:bg-accent/10"
            >
              Connect Bank
            </Button>
          </div>
        </Card>

        {/* Connected Accounts */}
        {connectedAccounts.length > 0 && (
          <div className="mb-8">
            <h2 className="text-lg font-medium text-foreground mb-4">Connected Accounts</h2>
            <div className="space-y-4">
              {connectedAccounts.map((account) => (
                <Card key={account.id} className="p-6 bg-white border border-border shadow-lg">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 bg-accent/10 rounded-lg flex items-center justify-center">
                        <Building2 className="w-6 h-6 text-accent" />
                      </div>
                      <div>
                        <h3 className="font-medium text-foreground">{account.name}</h3>
                        <p className="text-muted-foreground text-sm">
                          {account.type.charAt(0).toUpperCase() + account.type.slice(1)} •••• {account.mask}
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                          <CheckCircle className="w-4 h-4 text-accent" />
                          <span className="text-xs text-muted-foreground">Last synced {account.lastSync}</span>
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold text-foreground">
                        ${Math.abs(account.balance).toLocaleString()}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {account.type === 'credit' ? 'Outstanding' : 'Available'}
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-2 text-primary border-primary/20 hover:bg-primary/5"
                      >
                        Sync Now
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* Pending/Disconnected Accounts */}
        {pendingAccounts.length > 0 && (
          <div className="mb-8">
            <h2 className="text-lg font-medium text-foreground mb-4">Reconnection Required</h2>
            <div className="space-y-4">
              {pendingAccounts.map((account) => (
                <Card key={account.id} className="p-6 bg-white border-0 shadow-xl border-l-4 border-l-orange-400">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 bg-orange-100 rounded-xl flex items-center justify-center">
                        <AlertCircle className="w-6 h-6 text-orange-600" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-slate-900">{account.name}</h3>
                        <p className="text-slate-600 text-sm">
                          {account.type.charAt(0).toUpperCase() + account.type.slice(1)} •••• {account.mask}
                        </p>
                        <p className="text-orange-600 text-xs mt-1">Connection expired - please reconnect</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <Button
                        onClick={onConnect}
                        className="bg-orange-600 hover:bg-orange-700 text-white"
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
        <Card className="p-6 bg-white border-0 shadow-xl">
          <h3 className="text-lg font-semibold text-slate-900 mb-4">Why Connect Your Bank?</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex items-start gap-3">
              <CheckCircle className="w-5 h-5 text-emerald-600 mt-0.5" />
              <div>
                <p className="font-medium text-slate-900">Automatic Expense Tracking</p>
                <p className="text-sm text-slate-600">All business transactions imported automatically</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <CheckCircle className="w-5 h-5 text-emerald-600 mt-0.5" />
              <div>
                <p className="font-medium text-slate-900">Smart Categorization</p>
                <p className="text-sm text-slate-600">AI-powered expense classification</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <CheckCircle className="w-5 h-5 text-emerald-600 mt-0.5" />
              <div>
                <p className="font-medium text-slate-900">Real-time Deduction Tracking</p>
                <p className="text-sm text-slate-600">See tax savings as they happen</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <CheckCircle className="w-5 h-5 text-emerald-600 mt-0.5" />
              <div>
                <p className="font-medium text-slate-900">Bank-level Security</p>
                <p className="text-sm text-slate-600">256-bit encryption, read-only access</p>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
};
