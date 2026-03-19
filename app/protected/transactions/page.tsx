"use client";

import React, { useState, useMemo, useEffect, useRef } from 'react';
import type { Account } from '@/lib/firebase/accounts';
// Simple modal component
type ModalProps = {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
};
function Modal({ open, onClose, children }: ModalProps) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-30">
      <div className="bg-card text-foreground border border-border rounded-lg shadow-lg p-4 md:p-6 min-w-[320px] relative max-h-[90vh] overflow-y-auto">
        <button onClick={onClose} className="absolute top-2 right-2 text-muted-foreground hover:text-foreground">
          <X className="w-5 h-5" />
        </button>
        {children}
      </div>
    </div>
  );
}
import { Search, Calendar, ArrowUpDown, Filter, Camera, Plus, X, FileText, ChevronDown } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/firebase/auth-context';
import { useTransactions } from '@/lib/firebase/hooks';
import { SyncStatusIndicator } from '@/components/sync-status-indicator';
import { getAccounts } from '@/lib/firebase/accounts';
import { createTransaction } from '@/lib/firebase/transactions';
import { useRouter } from 'next/navigation';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { formatCategory, consolidateCategory } from '@/lib/utils';
import { getUserTaxRate } from '@/lib/tax-rules/federal-brackets';

interface Transaction {
  id: string;
  trans_id?: string;
  merchant_name: string;
  amount: number;
  type?: 'expense' | 'income';
  category: string;
  date: string;
  is_deductible?: boolean | null;
  deductible_reason?: string;
  deduction_score?: number;
  notes?: string;
  receipt_url?: string;
  receipt_filename?: string;
}

export default function TransactionsPage() {
  const { user } = useAuth(); // Already declared at the top
  const [showAddModal, setShowAddModal] = useState(false);
  const [showReceiptModal, setShowReceiptModal] = useState(false);
  const [newTransaction, setNewTransaction] = useState({ merchant_name: '', amount: '', category: '', account_id: '' });
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [accountsError, setAccountsError] = useState(null);

  // Static categories for dropdown (customize as needed)
  const categoryOptions = [
    'Food & Drink',
    'Transportation',
    'Travel',
    'Entertainment',
    'Professional Services',
    'Office & Equipment',
    'Loan & Financial',
    'General Merchandise',
    'Income',
    'Other',
  ];
  // Fetch accounts for dropdown
  useEffect(() => {
    if (!user || !user.id) return;
    setAccountsLoading(true);
    getAccounts(user.id)
      .then(({ data, error }) => {
        if (error) setAccountsError(error);
        else setAccounts(data);
      })
      .finally(() => setAccountsLoading(false));
  }, [user]);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [activeTab, setActiveTab] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [dateRange, setDateRange] = useState<'all' | 'today' | 'week' | 'month' | 'quarter' | 'year' | 'custom'>('month');
  const [sortBy, setSortBy] = useState<'date' | 'amount' | 'merchant'>('date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [amountRange, setAmountRange] = useState<'all' | 'under-50' | '50-200' | '200-500' | 'over-500'>('all');
  const [customDateStart, setCustomDateStart] = useState('');
  const [customDateEnd, setCustomDateEnd] = useState('');
  const router = useRouter();

  // useAuth() is already called at the top of this component

  // Use real-time transactions hook for instant updates
  const { transactions, isLoading: loading, error } = useTransactions(user?.id || '');

  // Apply learning to pending transactions once per session when we have pending items
  const applyLearningRunRef = useRef(false);
  useEffect(() => {
    if (loading || !user?.id || applyLearningRunRef.current) return;
    const pending = transactions.filter((t) => t.is_deductible === null || t.is_deductible === undefined);
    if (pending.length === 0) return;
    applyLearningRunRef.current = true;
    fetch('/api/transactions/apply-learning', { method: 'POST', credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && (data.applied as number) > 0) {
          // Real-time hook will re-render with updated transactions
        }
      })
      .catch(() => {})
      .finally(() => {});
  }, [loading, user?.id, transactions.length]);

  // Handle error state
  if (error) {
    console.error('Error loading transactions:', error);
  }

  // Calculate summary statistics
  const deductibleTransactions = transactions.filter(t => t.is_deductible === true);
  const personalTransactions = transactions.filter(t => t.is_deductible === false);
  const pendingTransactions = transactions.filter(t => t.is_deductible === null || t.is_deductible === undefined);

  const deductibleTotal = deductibleTransactions.reduce((sum, t) => sum + Math.abs(t.amount), 0);
  const pendingTotal = pendingTransactions.reduce((sum, t) => sum + Math.abs(t.amount), 0);
  const potentialSavings = deductibleTotal * getUserTaxRate();

  // Get unique consolidated categories for filter dropdown
  const uniqueCategories = useMemo(() => {
    const consolidatedCategories = transactions.map(t => consolidateCategory(t.category));
    const uniqueConsolidated = [...new Set(consolidatedCategories.map(c => c.consolidatedName))].filter(Boolean);
    return uniqueConsolidated.sort();
  }, [transactions]);

  // Date range helper functions
  const getDateRange = (range: string) => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    switch (range) {
      case 'today':
        return { start: today, end: new Date(today.getTime() + 24 * 60 * 60 * 1000) };
      case 'week':
        const weekStart = new Date(today);
        weekStart.setDate(today.getDate() - today.getDay());
        return { start: weekStart, end: new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000) };
      case 'month':
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        return { start: monthStart, end: monthEnd };
      case 'quarter':
        const quarterStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
        const quarterEnd = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3 + 3, 1);
        return { start: quarterStart, end: quarterEnd };
      case 'year':
        const yearStart = new Date(now.getFullYear(), 0, 1);
        const yearEnd = new Date(now.getFullYear() + 1, 0, 1);
        return { start: yearStart, end: yearEnd };
      case 'custom':
        return {
          start: customDateStart ? new Date(customDateStart) : null,
          end: customDateEnd ? new Date(customDateEnd) : null
        };
      default:
        return { start: null, end: null };
    }
  };

  // Filter transactions based on all filters
  const getFilteredTransactions = useMemo(() => {
    let filtered = transactions;

    // Tab filter (deductible/personal/pending)
    if (activeTab === 'deductible') {
      filtered = filtered.filter(t => t.is_deductible === true);
    } else if (activeTab === 'personal') {
      filtered = filtered.filter(t => t.is_deductible === false);
    } else if (activeTab === 'pending') {
      filtered = filtered.filter(t => t.is_deductible === null || t.is_deductible === undefined);
    }

    // Search filter
    if (searchTerm) {
      filtered = filtered.filter(t =>
        t.merchant_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        t.category.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (t.notes && t.notes.toLowerCase().includes(searchTerm.toLowerCase()))
      );
    }

    // Date range filter
    if (dateRange !== 'all') {
      const { start, end } = getDateRange(dateRange);
      if (start && end) {
        filtered = filtered.filter(t => {
          const transactionDate = new Date(t.date);
          return transactionDate >= start && transactionDate < end;
        });
      }
    }

    // Category filter
    if (categoryFilter !== 'all') {
      filtered = filtered.filter(t => consolidateCategory(t.category).consolidatedName === categoryFilter);
    }

    // Amount range filter
    if (amountRange !== 'all') {
      filtered = filtered.filter(t => {
        const amount = Math.abs(t.amount);
        switch (amountRange) {
          case 'under-50': return amount < 50;
          case '50-200': return amount >= 50 && amount < 200;
          case '200-500': return amount >= 200 && amount < 500;
          case 'over-500': return amount >= 500;
          default: return true;
        }
      });
    }

    // Sort transactions
    filtered.sort((a, b) => {
      let comparison = 0;
      switch (sortBy) {
        case 'date':
          comparison = new Date(a.date).getTime() - new Date(b.date).getTime();
          break;
        case 'amount':
          comparison = Math.abs(a.amount) - Math.abs(b.amount);
          break;
        case 'merchant':
          comparison = a.merchant_name.localeCompare(b.merchant_name);
          break;
      }
      return sortOrder === 'asc' ? comparison : -comparison;
    });

    return filtered;
  }, [transactions, activeTab, searchTerm, dateRange, categoryFilter, amountRange, sortBy, sortOrder, customDateStart, customDateEnd]);

  // Count active filters
  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (dateRange !== 'all') count++;
    if (categoryFilter !== 'all') count++;
    if (amountRange !== 'all') count++;
    return count;
  }, [dateRange, categoryFilter, amountRange]);

  // Clear all filters
  const clearAllFilters = () => {
    setDateRange('all');
    setCategoryFilter('all');
    setAmountRange('all');
    setCustomDateStart('');
    setCustomDateEnd('');
    setSearchTerm('');
    setActiveTab('all');
  };

  const getStatusBadge = (transaction: Transaction) => {
    if (transaction.is_deductible === true) {
      return (
        <div className="flex items-center gap-2">
          <Badge variant="success">Deductible</Badge>
        </div>
      );
    } else if (transaction.is_deductible === false) {
      return (
        <div className="flex items-center gap-2">
          <Badge variant="secondary">Personal</Badge>
        </div>
      );
    } else {
      return (
        <div className="flex items-center gap-2">
          <Badge variant="outline">Pending</Badge>
        </div>
      );
    }
  };

  const getCategoryBadge = (category: string) => {
    const { consolidatedName, displayName } = consolidateCategory(category);
    // Premium fintech: low-opacity bg, solid border, hover glow desktop only
    const categoryColors: { [key: string]: string } = {
      'FOOD_AND_DRINK': 'bg-[hsl(var(--success)/0.12)] text-[hsl(var(--success))] border-[hsl(var(--success)/0.4)] md:hover:shadow-[0_0_0_1px_hsl(var(--success)/0.25)]',
      'PROFESSIONAL_SERVICES': 'bg-cyan-500/10 text-cyan-400 border-cyan-500/40 md:hover:shadow-[0_0_0_1px_rgba(34,211,238,0.3)]',
      'LOAN_AND_FINANCIAL': 'bg-[hsl(var(--destructive)/0.12)] text-[hsl(var(--destructive)/0.95)] border-[hsl(var(--destructive)/0.35)] md:hover:shadow-[0_0_0_1px_hsl(var(--destructive)/0.2)]',
      'GENERAL_MERCHANDISE': 'bg-slate-500/10 text-slate-400 border-slate-500/35 md:hover:shadow-[0_0_0_1px_rgba(100,116,139,0.3)]',
      'TRANSFER': 'bg-[hsl(var(--chart-4)/0.15)] text-[hsl(var(--chart-4))] border-[hsl(var(--chart-4)/0.4)] md:hover:shadow-[0_0_0_1px_hsl(var(--chart-4)/0.25)]',
      'TRANSPORTATION': 'bg-primary/10 text-primary border-primary/40 md:hover:shadow-[0_0_0_1px_hsl(var(--primary)/0.25)]',
      'TRAVEL': 'bg-[hsl(var(--chart-4)/0.12)] text-[hsl(var(--chart-4)/0.95)] border-[hsl(var(--chart-4)/0.35)] md:hover:shadow-[0_0_0_1px_hsl(var(--chart-4)/0.2)]',
      'ENTERTAINMENT': 'bg-[hsl(var(--warning)/0.12)] text-[hsl(var(--warning)/0.95)] border-[hsl(var(--warning)/0.35)] md:hover:shadow-[0_0_0_1px_hsl(var(--warning)/0.2)]',
      'OFFICE_AND_EQUIPMENT': 'bg-sky-500/10 text-sky-400 border-sky-500/35 md:hover:shadow-[0_0_0_1px_rgba(14,165,233,0.25)]',
      'INCOME': 'bg-[hsl(var(--success)/0.12)] text-[hsl(var(--success))] border-[hsl(var(--success)/0.4)] md:hover:shadow-[0_0_0_1px_hsl(var(--success)/0.25)]',
    };
    const colorClass = categoryColors[consolidatedName] || 'bg-muted/50 text-muted-foreground border-border md:hover:shadow-[0_0_0_1px_hsl(var(--border))]';
    return <Badge className={`${colorClass} border text-[10px] sm:text-xs px-2 py-0.5 transition-shadow duration-150`}>{displayName}</Badge>;
  };


  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-lg">Loading transactions...</div>
      </div>
    );
  }

  const filteredTransactions = getFilteredTransactions;

  return (
    <div className="bg-background text-foreground min-h-screen overflow-x-hidden">
      {/* Header */}
      <div className="bg-background">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div>
              <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-foreground mb-1">Transactions</h1>
              <p className="text-sm sm:text-base text-muted-foreground">Your transaction management and categorization overview</p>
            </div>
            {/* Sync Status Indicator */}
            <SyncStatusIndicator compact={false} showCountdown={true} />
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 space-y-4 sm:space-y-6">
        {/* Summary Cards — semantic accents, premium fintech */}
        <div className="grid grid-cols-1 min-[480px]:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 md:gap-5">
          <div
            className="bg-card rounded-xl p-4 sm:p-5 border border-border border-l-[3px] border-l-[hsl(var(--success)/0.8)] shadow-[0_0_0_1px_hsl(var(--success)/0.06),0_2px_8px_-2px_hsl(var(--success)/0.12)] cursor-pointer hover:shadow-[0_0_0_1px_hsl(var(--success)/0.1),0_4px_12px_-2px_hsl(var(--success)/0.15)] active:scale-[0.99] transition-all duration-150 min-h-[44px] flex flex-col justify-center"
            onClick={() => setActiveTab('deductible')}
          >
            <div className="text-xl sm:text-2xl font-semibold text-foreground tabular-nums">${deductibleTotal.toFixed(2)}</div>
            <div className="text-xs sm:text-sm text-muted-foreground/90 mt-0.5">{deductibleTransactions.length} deductible</div>
          </div>
          <div
            className="bg-card rounded-xl p-4 sm:p-5 border border-border border-l-[3px] border-l-[hsl(var(--warning)/0.75)] shadow-[0_0_0_1px_hsl(var(--warning)/0.06),0_2px_8px_-2px_hsl(var(--warning)/0.1)] cursor-pointer hover:shadow-[0_0_0_1px_hsl(var(--warning)/0.1),0_4px_12px_-2px_hsl(var(--warning)/0.14)] active:scale-[0.99] transition-all duration-150 min-h-[44px] flex flex-col justify-center"
            onClick={() => setActiveTab('pending')}
          >
            <div className="text-xl sm:text-2xl font-semibold text-foreground tabular-nums">${pendingTotal.toFixed(2)}</div>
            <div className="text-xs sm:text-sm text-muted-foreground/90 mt-0.5">{pendingTransactions.length} needs review</div>
          </div>
          <div
            className="bg-card rounded-xl p-4 sm:p-5 border border-border border-l-[3px] border-l-primary/70 shadow-[0_0_0_1px_hsl(var(--primary)/0.06),0_2px_8px_-2px_hsl(var(--primary)/0.1)] cursor-pointer hover:shadow-[0_0_0_1px_hsl(var(--primary)/0.1),0_4px_12px_-2px_hsl(var(--primary)/0.14)] active:scale-[0.99] transition-all duration-150 min-h-[44px] flex flex-col justify-center"
            onClick={() => {}}
          >
            <div className="text-xl sm:text-2xl font-semibold text-foreground tabular-nums">${potentialSavings.toFixed(2)}</div>
            <div className="text-xs sm:text-sm text-muted-foreground/90 mt-0.5">Potential savings</div>
          </div>
          <div
            className="bg-card rounded-xl p-4 sm:p-5 border border-border border-l-[3px] border-l-muted-foreground/50 shadow-[0_2px_8px_-2px_rgba(0,0,0,0.08)] cursor-pointer hover:bg-muted/30 hover:shadow-[0_4px_12px_-2px_rgba(0,0,0,0.1)] active:scale-[0.99] transition-all duration-150 min-h-[44px] flex flex-col justify-center"
            onClick={() => setActiveTab('all')}
          >
            <div className="text-xl sm:text-2xl font-semibold text-foreground tabular-nums">{transactions.length}</div>
            <div className="text-xs sm:text-sm text-muted-foreground/90 mt-0.5">Total transactions</div>
          </div>
        </div>

        {/* Search and Filter Bar — premium fintech: stack on mobile, pill controls */}
        <div className="bg-card rounded-xl p-3 sm:p-4 shadow-sm border border-border">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            {/* Search Input — full-width on mobile, soft inner shadow, 44px tap */}
            <div className="w-full sm:flex-1 relative min-w-0 order-1 sm:order-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground w-4 h-4 pointer-events-none" />
              <input
                type="text"
                placeholder="Search merchant, category, notes..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-2.5 min-h-[44px] text-sm border border-border rounded-xl bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-primary/30 shadow-[inset_0_1px_2px_rgba(0,0,0,0.04)] dark:shadow-[inset_0_1px_2px_rgba(0,0,0,0.2)] transition-all duration-150"
              />
            </div>

            {/* Filters row — horizontally scrollable on mobile, pill-style */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0 scrollbar-none min-h-[44px] shrink-0 order-2 sm:order-2">
            {/* Date Range Selector */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="flex items-center gap-1.5 px-3 py-2 min-h-[44px] rounded-xl shrink-0 no-tap-highlight border-border bg-muted/30 hover:bg-muted/60 hover:shadow-[0_0_0_1px_hsl(var(--primary)/0.08)] focus-visible:ring-2 focus-visible:ring-ring transition-all duration-150">
                  <Calendar className="w-4 h-4 text-muted-foreground" />
                  <span className="text-xs sm:text-sm text-muted-foreground whitespace-nowrap">
                    {dateRange === 'all' ? 'All' :
                      dateRange === 'today' ? 'Today' :
                        dateRange === 'week' ? 'Week' :
                          dateRange === 'month' ? 'Month' :
                            dateRange === 'quarter' ? 'Quarter' :
                              dateRange === 'year' ? 'Year' :
                                dateRange === 'custom' ? 'Custom' : 'All'}
                  </span>
                  <ChevronDown className="w-3 h-3 shrink-0" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuLabel>Date Range</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setDateRange('all')}>
                  All time
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setDateRange('today')}>
                  Today
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setDateRange('week')}>
                  This week
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setDateRange('month')}>
                  This month
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setDateRange('quarter')}>
                  This quarter
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setDateRange('year')}>
                  This year
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setDateRange('custom')}>
                  Custom range
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Sort Dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="flex items-center gap-1.5 px-3 py-2 min-h-[44px] rounded-xl shrink-0 no-tap-highlight border-border bg-muted/30 hover:bg-muted/60 hover:shadow-[0_0_0_1px_hsl(var(--primary)/0.08)] focus-visible:ring-2 focus-visible:ring-ring transition-all duration-150">
                  <ArrowUpDown className="w-4 h-4" />
                  <span className="text-xs sm:text-sm whitespace-nowrap">Sort</span>
                  <ChevronDown className="w-3 h-3 shrink-0" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuLabel>Sort by</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => { setSortBy('date'); setSortOrder('desc'); }}>
                  Date (Newest first)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => { setSortBy('date'); setSortOrder('asc'); }}>
                  Date (Oldest first)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => { setSortBy('amount'); setSortOrder('desc'); }}>
                  Amount (Highest first)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => { setSortBy('amount'); setSortOrder('asc'); }}>
                  Amount (Lowest first)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => { setSortBy('merchant'); setSortOrder('asc'); }}>
                  Merchant (A-Z)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => { setSortBy('merchant'); setSortOrder('desc'); }}>
                  Merchant (Z-A)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Filter Dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="relative flex items-center gap-1.5 px-3 py-2 min-h-[44px] rounded-xl shrink-0 no-tap-highlight border-border bg-muted/30 hover:bg-muted/60 hover:shadow-[0_0_0_1px_hsl(var(--primary)/0.08)] focus-visible:ring-2 focus-visible:ring-ring transition-all duration-150">
                  <Filter className="w-4 h-4" />
                  <span className="text-xs sm:text-sm whitespace-nowrap">Filter</span>
                  {activeFiltersCount > 0 && (
                    <Badge className="absolute -top-0.5 -right-0.5 bg-primary text-primary-foreground text-[10px] px-1.5 py-0 min-w-[18px] h-[18px] flex items-center justify-center rounded-full">
                      {activeFiltersCount}
                    </Badge>
                  )}
                  <ChevronDown className="w-3 h-3 shrink-0" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel>Filters</DropdownMenuLabel>
                <DropdownMenuSeparator />

                {/* Category Filter */}
                <div className="px-2 py-1">
                  <div className="text-xs font-medium text-muted-foreground mb-1">Category</div>
                  <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="All categories" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All categories</SelectItem>
                      {uniqueCategories.map(category => (
                        <SelectItem key={category} value={category}>
                          {consolidateCategory(category).displayName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <DropdownMenuSeparator />

                {/* Amount Range Filter */}
                <div className="px-2 py-1">
                  <div className="text-xs font-medium text-muted-foreground mb-1">Amount Range</div>
                  <Select value={amountRange} onValueChange={val => setAmountRange(val as typeof amountRange)}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="All amounts" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All amounts</SelectItem>
                      <SelectItem value="under-50">Under $50</SelectItem>
                      <SelectItem value="50-200">$50 - $200</SelectItem>
                      <SelectItem value="200-500">$200 - $500</SelectItem>
                      <SelectItem value="over-500">Over $500</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <DropdownMenuSeparator />

                <DropdownMenuItem onClick={clearAllFilters} className="text-red-600">
                  Clear all filters
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            </div>
          </div>

          {/* Custom Date Range Inputs - Shows below when custom is selected */}
          {dateRange === 'custom' && (
            <div className="flex items-center gap-2 mt-2 pt-2 border-t border-border">
              <input
                type="date"
                value={customDateStart}
                onChange={(e) => setCustomDateStart(e.target.value)}
                className="flex-1 px-2 py-1.5 text-xs border border-border rounded bg-background text-foreground"
                placeholder="Start date"
              />
              <span className="text-xs text-muted-foreground">to</span>
              <input
                type="date"
                value={customDateEnd}
                onChange={(e) => setCustomDateEnd(e.target.value)}
                className="flex-1 px-2 py-1.5 text-xs border border-border rounded bg-background text-foreground"
                placeholder="End date"
              />
            </div>
          )}

          {/* Active Filters Display */}
          {activeFiltersCount > 0 && (
            <div className="flex items-center gap-2 mt-2 pt-2 border-t border-border text-xs text-muted-foreground">
              <span>{activeFiltersCount} filter{activeFiltersCount > 1 ? 's' : ''} active</span>
              <button
                type="button"
                className="min-w-[44px] min-h-[44px] flex items-center justify-center text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted/50 transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring"
                onClick={clearAllFilters}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {/* Status Tabs — pill-style segmented, hover glow, 44px tap */}
        <div className="flex gap-1.5 p-1 rounded-xl bg-muted/40 border border-border/50 w-fit max-w-full overflow-x-auto scrollbar-none mb-6">
          <button
            type="button"
            onClick={() => setActiveTab('all')}
            className={`px-4 py-2.5 rounded-lg text-xs sm:text-sm font-medium transition-all duration-150 min-h-[44px] whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${activeTab === 'all'
              ? 'bg-primary text-primary-foreground shadow-[0_0_0_1px_hsl(var(--primary)/0.2)]'
              : 'text-muted-foreground hover:bg-muted/80 hover:text-foreground hover:shadow-[0_0_0_1px_hsl(var(--primary)/0.06)] active:bg-muted'
              }`}
          >
            All ({transactions.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('deductible')}
            className={`px-4 py-2.5 rounded-lg text-xs sm:text-sm font-medium transition-all duration-150 min-h-[44px] whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${activeTab === 'deductible'
              ? 'bg-primary text-primary-foreground shadow-[0_0_0_1px_hsl(var(--primary)/0.2)]'
              : 'text-muted-foreground hover:bg-muted/80 hover:text-foreground hover:shadow-[0_0_0_1px_hsl(var(--primary)/0.06)] active:bg-muted'
              }`}
          >
            Deductible ({deductibleTransactions.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('personal')}
            className={`px-4 py-2.5 rounded-lg text-xs sm:text-sm font-medium transition-all duration-150 min-h-[44px] whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${activeTab === 'personal'
              ? 'bg-primary text-primary-foreground shadow-[0_0_0_1px_hsl(var(--primary)/0.2)]'
              : 'text-muted-foreground hover:bg-muted/80 hover:text-foreground hover:shadow-[0_0_0_1px_hsl(var(--primary)/0.06)] active:bg-muted'
              }`}
          >
            Personal ({personalTransactions.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('pending')}
            className={`px-4 py-2.5 rounded-lg text-xs sm:text-sm font-medium transition-all duration-150 min-h-[44px] whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${activeTab === 'pending'
              ? 'bg-primary text-primary-foreground shadow-[0_0_0_1px_hsl(var(--primary)/0.2)]'
              : 'text-muted-foreground hover:bg-muted/80 hover:text-foreground hover:shadow-[0_0_0_1px_hsl(var(--primary)/0.06)] active:bg-muted'
              }`}
          >
            Pending ({pendingTransactions.length})
          </button>
        </div>

        {/* Transaction List */}
        <div className="bg-card rounded-xl shadow-sm overflow-hidden border border-border">
          {/* Desktop Table View */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full">
              <thead className="bg-muted/60 border-b border-border">
                <tr>
                  <th className="px-5 py-3.5 text-left text-xs font-medium text-muted-foreground/80 uppercase tracking-wider">
                    Merchant
                  </th>
                  <th className="px-5 py-3.5 text-left text-xs font-medium text-muted-foreground/80 uppercase tracking-wider">
                    Date
                  </th>
                  <th className="px-5 py-3.5 text-left text-xs font-medium text-muted-foreground/80 uppercase tracking-wider">
                    Category
                  </th>
                  <th className="px-5 py-3.5 text-left text-xs font-medium text-muted-foreground/80 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-5 py-3.5 text-left text-xs font-medium text-muted-foreground/80 uppercase tracking-wider">
                    Direction
                  </th>
                  <th className="px-5 py-3.5 text-center text-xs font-medium text-muted-foreground/80 uppercase tracking-wider">
                    Receipt
                  </th>
                  <th className="px-5 py-3.5 text-right text-xs font-medium text-muted-foreground/80 uppercase tracking-wider">
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody className="bg-card divide-y divide-border">
                {filteredTransactions.map((transaction) => (
                  <tr
                    key={transaction.id}
                    className="hover:bg-[hsl(var(--primary)/0.04)] cursor-pointer transition-all duration-150 md:hover:-translate-y-px"
                    onClick={() => {
                      router.push(`/protected?screen=transaction-detail&transactionId=${transaction.id}&from=transactions`);
                    }}
                  >
                    <td className="px-5 py-4">
                      <div>
                        <div className="text-sm font-semibold text-foreground">
                          {transaction.merchant_name}
                        </div>
                        {transaction.notes && (
                          <div className="text-sm text-muted-foreground">{transaction.notes}</div>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-4 text-sm text-foreground">
                      {new Date(transaction.date).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric'
                      })}
                    </td>
                    <td className="px-5 py-4">
                      {getCategoryBadge(transaction.category)}
                    </td>
                    <td className="px-5 py-4">
                      {getStatusBadge(transaction)}
                    </td>
                    <td className="px-5 py-4 text-sm text-foreground">
                      {(transaction.type ?? (transaction.amount < 0 ? 'income' : 'expense')) === 'income' ? 'Received' : 'Paid'}
                    </td>
                    <td className="px-5 py-4 text-center">
                      {transaction.receipt_url ? (
                        <div className="flex items-center justify-center">
                          <div className="w-8 h-8 bg-accent/20 rounded-full flex items-center justify-center">
                            <FileText className="w-4 h-4 text-accent" />
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center justify-center">
                          <div className="w-8 h-8 bg-muted rounded-full flex items-center justify-center">
                            <FileText className="w-4 h-4 text-muted-foreground" />
                          </div>
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-4 text-right text-sm font-semibold font-tabular-nums transition-colors duration-150">
                      <span className={(transaction.type ?? (transaction.amount < 0 ? 'income' : 'expense')) === 'income' ? 'text-[hsl(var(--success))]' : 'text-destructive/85'}>
                        {(transaction.type ?? (transaction.amount < 0 ? 'income' : 'expense')) === 'income' ? '+' : '-'}${Math.abs(transaction.amount).toFixed(2)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile Card View — card layout, no horizontal scroll, 44px tap */}
          <div className="md:hidden divide-y divide-border">
            {filteredTransactions.map((transaction) => {
              const direction = (transaction.type ?? (transaction.amount < 0 ? 'income' : 'expense')) === 'income' ? 'Received' : 'Paid';
              const isReceived = direction === 'Received';
              return (
                <div
                  key={transaction.id}
                  role="button"
                  tabIndex={0}
                  className="min-h-[44px] p-4 hover:bg-muted/50 active:bg-muted cursor-pointer transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                  onClick={() => router.push(`/protected?screen=transaction-detail&transactionId=${transaction.id}&from=transactions`)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); router.push(`/protected?screen=transaction-detail&transactionId=${transaction.id}&from=transactions`); } }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-base font-semibold text-foreground truncate">
                        {transaction.merchant_name}
                      </div>
                      <div className="text-sm text-muted-foreground mt-0.5">
                        {new Date(transaction.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        <span className="mx-1.5">•</span>
                        {consolidateCategory(transaction.category).displayName}
                      </div>
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        {getStatusBadge(transaction)}
                        <span className={`text-xs font-medium ${isReceived ? 'text-[hsl(var(--success)/0.9)]' : 'text-destructive/70'}`}>
                          {direction}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`text-lg font-bold font-tabular-nums transition-colors duration-150 ${isReceived ? 'text-[hsl(var(--success))]' : 'text-destructive/85'}`}>
                        {isReceived ? '+' : '-'}${Math.abs(transaction.amount).toFixed(2)}
                      </span>
                      <span
                        className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg bg-muted/50 border border-border/50"
                        aria-hidden
                      >
                        {transaction.receipt_url ? (
                          <FileText className="w-4 h-4 text-primary" />
                        ) : (
                          <FileText className="w-4 h-4 text-muted-foreground" />
                        )}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Top Right Action Buttons */}
        <div className="fixed bottom-4 right-4 sm:bottom-6 sm:right-6 flex flex-col sm:flex-row gap-3 z-40">
          <Button
            className="bg-card text-foreground border border-border hover:bg-muted active:bg-muted/80 touch-target min-h-[44px] shadow-lg"
            onClick={() => setShowReceiptModal(true)}
          >
            <Camera className="w-4 h-4 sm:mr-2" />
            <span className="hidden sm:inline">Receipt</span>
          </Button>
          <Button
            className="bg-primary text-primary-foreground hover:bg-primary-hover active:bg-primary/90 touch-target min-h-[44px] shadow-lg"
            onClick={() => setShowAddModal(true)}
          >
            <Plus className="w-4 h-4 sm:mr-2" />
            <span className="hidden sm:inline">+ Add</span>
            <span className="sm:hidden">Add</span>
          </Button>
        </div>

        {/* Add Transaction Modal */}
        <Modal open={showAddModal} onClose={() => setShowAddModal(false)}>
          <h2 className="text-lg font-bold mb-4 text-foreground">Add Transaction</h2>
          <form
            onSubmit={async e => {
              e.preventDefault();
              if (!user?.id || !newTransaction.account_id || !newTransaction.category) return;
              const txData = {
                ...newTransaction,
                amount: parseFloat(newTransaction.amount),
                date: new Date().toISOString().slice(0, 10), // Default to today
              };
              await createTransaction(user.id, newTransaction.account_id, txData);
              setShowAddModal(false);
              setNewTransaction({ merchant_name: '', amount: '', category: '', account_id: '' });
            }}
          >
            {/* Account Dropdown */}
            <select
              className="w-full border border-border rounded p-2 mb-2 bg-background text-foreground"
              value={newTransaction.account_id}
              onChange={e => setNewTransaction({ ...newTransaction, account_id: e.target.value })}
              required
              disabled={accountsLoading}
            >
              <option value="">Select Account</option>
              {accounts.map(acc => (
                <option key={acc.id} value={acc.account_id}>
                  {acc.name || acc.account_id}
                </option>
              ))}
            </select>
            {/* Merchant Name */}
            <input
              className="w-full border border-border rounded p-2 mb-2 bg-background text-foreground"
              placeholder="Merchant Name"
              value={newTransaction.merchant_name}
              onChange={e => setNewTransaction({ ...newTransaction, merchant_name: e.target.value })}
              required
            />
            {/* Amount */}
            <input
              className="w-full border border-border rounded p-2 mb-2 bg-background text-foreground"
              placeholder="Amount"
              type="number"
              value={newTransaction.amount}
              onChange={e => setNewTransaction({ ...newTransaction, amount: e.target.value })}
              required
            />
            {/* Category Dropdown */}
            <select
              className="w-full border border-border rounded p-2 mb-4 bg-background text-foreground"
              value={newTransaction.category}
              onChange={e => setNewTransaction({ ...newTransaction, category: e.target.value })}
              required
            >
              <option value="">Select Category</option>
              {categoryOptions.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setShowAddModal(false)}>Cancel</Button>
              <Button type="submit" className="bg-primary text-primary-foreground hover:bg-primary-hover">Add</Button>
            </div>
          </form>
        </Modal>

        {/* Receipt Upload Modal */}
        <Modal open={showReceiptModal} onClose={() => setShowReceiptModal(false)}>
          <h2 className="text-lg font-bold mb-4 text-foreground">Upload Receipt</h2>
          <input
            type="file"
            accept="image/*,application/pdf"
            onChange={e => setReceiptFile(e.target.files && e.target.files[0] ? e.target.files[0] : null)}
            className="mb-4 text-sm text-muted-foreground"
          />
          {receiptFile && <div className="mb-2 text-sm">Selected: {receiptFile.name}</div>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setShowReceiptModal(false)}>Cancel</Button>
            <Button type="button" className="bg-primary text-primary-foreground hover:bg-primary-hover" onClick={() => setShowReceiptModal(false)}>Upload</Button>
          </div>
        </Modal>
      </div>
    </div>
  );
}
