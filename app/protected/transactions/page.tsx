"use client";

import { formatTransactionDate, transactionCalendarDate } from '@/lib/transactions/calendar-date';
import React, { useEffect, useState, useMemo } from 'react';
import { Search, Filter, Camera, Plus, X, FileText, ChevronDown, ChevronRight, ArrowRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/firebase/auth-context';
import { useTransactions } from '@/lib/firebase/hooks';
import { useRouter } from 'next/navigation';
import { protectedScreenUrl } from '@/lib/navigation/protected-screens';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { consolidateCategory } from '@/lib/utils';
import { transactionNeedsTaxReview } from '@/lib/utils/transaction-tax-review';

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
  pending?: boolean;
  user_classification_reason?: string;
}

// Display saved classifications, not a tax calculation. A credit/refund alone is not business income.
function transactionStatus(transaction: Transaction) {
  if (transaction.pending === true) return 'pending';
  if (['income', 'revenue'].includes(transaction.category.toLowerCase())) return 'income';
  if (transaction.is_deductible === true) return 'deductible';
  if (transaction.is_deductible === false) return 'personal';
  return transactionNeedsTaxReview(transaction) ? 'review' : 'skipped';
}

function transactionDirection(transaction: Transaction) {
  if (transaction.pending === true) return 'Pending';
  return (transaction.type ?? (transaction.amount < 0 ? 'income' : 'expense')) === 'income' ? 'Received' : 'Paid';
}

export default function TransactionsPage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  // Default to "All time" so no filter is active on initial page load.
  const [dateRange, setDateRange] = useState<'all' | 'today' | 'week' | 'month' | 'quarter' | 'year' | 'custom'>('all');
  const [sortBy, setSortBy] = useState<'date' | 'amount' | 'merchant'>('date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [amountRange, setAmountRange] = useState<'all' | 'under-50' | '50-200' | '200-500' | 'over-500'>('all');
  const [customDateStart, setCustomDateStart] = useState('');
  const [customDateEnd, setCustomDateEnd] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const router = useRouter();

  // useAuth() is already called at the top of this component

  // Use real-time transactions hook for instant updates
  const { transactions, isLoading: loading, error } = useTransactions(user?.id || '');

  // Deep link from the assistant's "Review these charges" button: /protected/transactions?merchant=<name>.
  // Read once on mount (no Suspense boundary needed); the value only seeds the search box.
  useEffect(() => {
    const merchant = new URLSearchParams(window.location.search).get('merchant')?.trim();
    if (merchant) setSearchTerm(merchant.slice(0, 80));
  }, []);

  // Handle error state
  if (error) {
    console.error('Error loading transactions:', error);
  }

  // Record counts only: tax totals belong to the shared federal Tax Preview.
  const deductibleTransactions = transactions.filter(t => transactionStatus(t) === 'deductible');
  const personalTransactions = transactions.filter(t => transactionStatus(t) === 'personal');
  const pendingTransactions = transactions.filter(t => ['pending', 'review'].includes(transactionStatus(t)));

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
          start: customDateStart ? transactionCalendarDate(customDateStart) : null,
          end: customDateEnd ? transactionCalendarDate(customDateEnd) : null
        };
      default:
        return { start: null, end: null };
    }
  };

  // Filter transactions based on all filters
  const getFilteredTransactions = useMemo(() => {
    let filtered = [...transactions];

    // Tab filter (deductible/personal/pending)
    if (activeTab === 'deductible') {
      filtered = filtered.filter(t => transactionStatus(t) === 'deductible');
    } else if (activeTab === 'personal') {
      filtered = filtered.filter(t => transactionStatus(t) === 'personal');
    } else if (activeTab === 'pending') {
      filtered = filtered.filter(t => ['pending', 'review'].includes(transactionStatus(t)));
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
          const transactionDate = transactionCalendarDate(t.date);
          return transactionDate !== null && transactionDate >= start && transactionDate < end;
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
          comparison = (transactionCalendarDate(a.date)?.getTime() ?? 0) - (transactionCalendarDate(b.date)?.getTime() ?? 0);
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
    const status = transactionStatus(transaction);
    const labels = { pending: 'Pending', income: 'Income', deductible: 'Marked deductible', personal: 'Personal', review: 'Needs review', skipped: 'Skipped' };
    return (
      <Badge variant="secondary" className={`border-0 rounded-md px-1.5 py-0.5 text-xs font-medium ${status === 'review' ? 'bg-primary/8 text-primary' : 'bg-muted/60 text-muted-foreground'}`}>
        {labels[status]}
      </Badge>
    );
  };

  if (loading) {
    return (
      <div className="flex min-h-64 items-center justify-center text-sm text-muted-foreground" role="status">
        Loading transactions…
      </div>
    );
  }

  const filteredTransactions = getFilteredTransactions;
  const statusTabs = [
    { value: 'all', label: 'All', count: transactions.length },
    { value: 'pending', label: 'Review', count: pendingTransactions.length, description: 'Pending or needs review' },
    { value: 'deductible', label: 'Deductible', count: deductibleTransactions.length, description: 'Posted records marked deductible' },
    { value: 'personal', label: 'Personal', count: personalTransactions.length },
  ];
  const hasFilters = activeFiltersCount > 0 || Boolean(searchTerm) || activeTab !== 'all';
  const openTransaction = (transaction: Transaction) => router.push(protectedScreenUrl(
    `transaction-detail?transactionId=${encodeURIComponent(transaction.id)}&from=transactions`
  ));

  return (
    <div className="mx-auto w-full max-w-6xl space-y-3 px-4 pb-6 pt-3 text-foreground sm:px-6 sm:pt-5">
      <header className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">Transactions</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">{transactions.length} records · Your money, organized</p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button className="min-h-11 shrink-0 gap-1.5 rounded-xl px-3">
              <Plus className="h-4 w-4" /> Add <ChevronDown className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52 rounded-xl p-1.5">
            <DropdownMenuItem
              className="min-h-11 gap-2 rounded-lg"
              aria-label="Add transaction"
              onClick={() => router.push(protectedScreenUrl('add-manual-transaction'))}
            >
              <Plus className="h-4 w-4" /> Add transaction
            </DropdownMenuItem>
            <DropdownMenuItem
              className="min-h-11 gap-2 rounded-lg"
              aria-label="Upload receipt"
              onClick={() => router.push(protectedScreenUrl('receipt-upload'))}
            >
              <Camera className="h-4 w-4" /> Upload receipt
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <div className="flex items-center justify-between gap-2 rounded-xl border border-border/70 bg-card px-3 py-1">
        <button
          type="button"
          className="flex min-h-11 min-w-0 items-center gap-2 text-left text-sm font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => router.push(protectedScreenUrl('review-transactions'))}
        >
          Review transactions <ArrowRight className="h-4 w-4 shrink-0" />
        </button>
        <button
          type="button"
          className="min-h-11 shrink-0 rounded-lg px-2 text-xs font-medium text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => router.push(protectedScreenUrl('tax-preview'))}
        >
          Tax Preview
        </button>
      </div>

      {error && (
        <div role="alert" className="rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          Transactions could not be loaded. Refresh the page to try again.
        </div>
      )}

      <section aria-label="Find transactions" className="space-y-2">
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              aria-label="Search transactions"
              placeholder="Search merchant, category, notes…"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              className="h-11 w-full rounded-xl border border-border/70 bg-card pl-9 pr-3 text-base text-foreground sm:text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            aria-expanded={filtersOpen}
            aria-controls="transaction-filters"
            onClick={() => setFiltersOpen(open => !open)}
            className={`h-11 shrink-0 gap-1.5 rounded-xl px-3 text-xs ${filtersOpen || activeFiltersCount > 0 ? 'border-primary/30 bg-primary/5 text-primary' : 'bg-card'}`}
          >
            <Filter className="h-4 w-4" /> Filters{activeFiltersCount > 0 ? ` (${activeFiltersCount})` : ''}
          </Button>
        </div>

        {filtersOpen && (
          <div id="transaction-filters" className="grid grid-cols-2 gap-3 rounded-xl border border-border/70 bg-card p-3 sm:grid-cols-4">
            <label className="min-w-0 space-y-1 text-xs font-medium text-muted-foreground">
              <span>Date</span>
              <Select value={dateRange} onValueChange={value => setDateRange(value as typeof dateRange)}>
                <SelectTrigger className="min-h-11 data-[size=default]:h-11 rounded-lg text-sm" aria-label="Date range"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="min-h-11">All time</SelectItem>
                  <SelectItem value="today" className="min-h-11">Today</SelectItem>
                  <SelectItem value="week" className="min-h-11">This week</SelectItem>
                  <SelectItem value="month" className="min-h-11">This month</SelectItem>
                  <SelectItem value="quarter" className="min-h-11">This quarter</SelectItem>
                  <SelectItem value="year" className="min-h-11">This year</SelectItem>
                  <SelectItem value="custom" className="min-h-11">Custom range</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <label className="min-w-0 space-y-1 text-xs font-medium text-muted-foreground">
              <span>Category</span>
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="min-h-11 data-[size=default]:h-11 rounded-lg text-sm" aria-label="Category"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="min-h-11">All categories</SelectItem>
                  {uniqueCategories.map(category => <SelectItem key={category} value={category} className="min-h-11">{consolidateCategory(category).displayName}</SelectItem>)}
                </SelectContent>
              </Select>
            </label>
            <label className="min-w-0 space-y-1 text-xs font-medium text-muted-foreground">
              <span>Amount</span>
              <Select value={amountRange} onValueChange={value => setAmountRange(value as typeof amountRange)}>
                <SelectTrigger className="min-h-11 data-[size=default]:h-11 rounded-lg text-sm" aria-label="Amount range"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="min-h-11">All amounts</SelectItem>
                  <SelectItem value="under-50" className="min-h-11">Under $50</SelectItem>
                  <SelectItem value="50-200" className="min-h-11">$50 – $200</SelectItem>
                  <SelectItem value="200-500" className="min-h-11">$200 – $500</SelectItem>
                  <SelectItem value="over-500" className="min-h-11">$500 and over</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <label className="min-w-0 space-y-1 text-xs font-medium text-muted-foreground">
              <span>Sort</span>
              <Select value={`${sortBy}-${sortOrder}`} onValueChange={value => {
                const [field, order] = value.split('-');
                setSortBy(field as typeof sortBy); setSortOrder(order as typeof sortOrder);
              }}>
                <SelectTrigger className="min-h-11 data-[size=default]:h-11 rounded-lg text-sm" aria-label="Sort transactions"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="date-desc" className="min-h-11">Newest first</SelectItem>
                  <SelectItem value="date-asc" className="min-h-11">Oldest first</SelectItem>
                  <SelectItem value="amount-desc" className="min-h-11">Highest amount</SelectItem>
                  <SelectItem value="amount-asc" className="min-h-11">Lowest amount</SelectItem>
                  <SelectItem value="merchant-asc" className="min-h-11">Merchant A–Z</SelectItem>
                  <SelectItem value="merchant-desc" className="min-h-11">Merchant Z–A</SelectItem>
                </SelectContent>
              </Select>
            </label>
            {dateRange === 'custom' && (
              <div className="col-span-2 grid grid-cols-2 gap-3 sm:col-span-4">
                <label className="min-w-0 space-y-1 text-xs font-medium text-muted-foreground">
                  <span>Start date</span>
                  <input type="date" value={customDateStart} onChange={event => setCustomDateStart(event.target.value)} className="h-11 w-full min-w-0 rounded-lg border border-border bg-background px-2 text-base text-foreground sm:text-sm" />
                </label>
                <label className="min-w-0 space-y-1 text-xs font-medium text-muted-foreground">
                  <span>End date</span>
                  <input type="date" value={customDateEnd} onChange={event => setCustomDateEnd(event.target.value)} className="h-11 w-full min-w-0 rounded-lg border border-border bg-background px-2 text-base text-foreground sm:text-sm" />
                </label>
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-4 gap-1 rounded-xl bg-muted/70 p-1" aria-label="Transaction status">
          {statusTabs.map(tab => (
            <button
              key={tab.value}
              type="button"
              aria-pressed={activeTab === tab.value}
              aria-label={`${tab.description ?? tab.label}: ${tab.count}`}
              title={tab.description}
              onClick={() => setActiveTab(tab.value)}
              className={`flex min-h-11 min-w-0 flex-col items-center justify-center rounded-lg px-1 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex-row sm:gap-1.5 ${activeTab === tab.value ? 'bg-card font-semibold text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <span>{tab.label}</span><span className="tabular-nums">{tab.count}</span>
            </button>
          ))}
        </div>
      </section>

      <section aria-label="Transaction list" className="overflow-hidden rounded-xl border border-border/70 bg-card">
        <div className="flex min-h-9 items-center justify-between gap-2 border-b border-border/60 px-3">
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {filteredTransactions.length} {hasFilters ? 'matching' : 'total'} transaction{filteredTransactions.length === 1 ? '' : 's'}
          </p>
          {hasFilters && (
            <button type="button" className="-my-1 flex min-h-11 items-center gap-1 text-xs font-medium text-primary" onClick={clearAllFilters}>
              <X className="h-3.5 w-3.5" /> Clear filters
            </button>
          )}
        </div>
        {filteredTransactions.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <p className="text-sm font-semibold">{hasFilters ? 'No matching transactions' : 'Your transactions will appear here'}</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
              {hasFilters ? 'Try another search or clear your filters.' : 'Connect a bank, add a transaction, or upload a receipt to get started.'}
            </p>
            {!hasFilters && <Button variant="outline" className="mt-4 min-h-11 rounded-xl" onClick={() => router.push(protectedScreenUrl('banks-detail'))}>Connect a bank</Button>}
          </div>
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead className="border-b border-border/60 bg-muted/20 text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-4 py-2.5 text-left font-medium">Transaction</th>
                    <th scope="col" className="px-4 py-2.5 text-left font-medium">Category</th>
                    <th scope="col" className="px-4 py-2.5 text-left font-medium">Status</th>
                    <th scope="col" className="px-4 py-2.5 text-right font-medium">Amount</th>
                    <th scope="col" className="w-10 px-2 py-2.5"><span className="sr-only">Details</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {filteredTransactions.map(transaction => {
                    const isReceived = (transaction.type ?? (transaction.amount < 0 ? 'income' : 'expense')) === 'income';
                    return (
                      <tr key={transaction.id} className="cursor-pointer hover:bg-muted/30" onClick={() => openTransaction(transaction)}>
                        <td className="max-w-72 px-4 py-3">
                          <button type="button" className="-my-1 block min-h-11 w-full rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={event => { event.stopPropagation(); openTransaction(transaction); }}>
                            <span className="block truncate font-semibold">{transaction.merchant_name}</span>
                            <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                              {formatTransactionDate(transaction.date, 'en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                              {transaction.receipt_url && <FileText className="h-3.5 w-3.5" aria-label="Receipt attached" />}
                            </span>
                          </button>
                        </td>
                        <td className="max-w-52 px-4 py-3 text-muted-foreground"><span className="block truncate">{consolidateCategory(transaction.category).displayName}</span></td>
                        <td className="px-4 py-3">{getStatusBadge(transaction)}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right">
                          <span className="block font-semibold tabular-nums">{isReceived ? '+' : '-'}${Math.abs(transaction.amount).toFixed(2)}</span>
                          <span className="mt-0.5 block text-xs text-muted-foreground">{transactionDirection(transaction)}</span>
                        </td>
                        <td className="px-2"><ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="divide-y divide-border/60 md:hidden">
              {filteredTransactions.map(transaction => {
                const isReceived = (transaction.type ?? (transaction.amount < 0 ? 'income' : 'expense')) === 'income';
                return (
                  <div
                    key={transaction.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`View ${transaction.merchant_name}, ${transactionDirection(transaction).toLowerCase()} $${Math.abs(transaction.amount).toFixed(2)}`}
                    className="min-h-11 cursor-pointer px-3 py-3 transition-colors hover:bg-muted/30 active:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    onClick={() => openTransaction(transaction)}
                    onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openTransaction(transaction); } }}
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="min-w-0 truncate text-sm font-semibold">{transaction.merchant_name}</p>
                      <span className="shrink-0 text-sm font-semibold tabular-nums">{isReceived ? '+' : '-'}${Math.abs(transaction.amount).toFixed(2)}</span>
                    </div>
                    <div className="mt-0.5 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                      <p className="min-w-0 truncate">
                        {formatTransactionDate(transaction.date, 'en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        <span aria-hidden="true"> · </span>{consolidateCategory(transaction.category).displayName}
                      </p>
                      <span className="shrink-0">{transactionDirection(transaction)}</span>
                    </div>
                    <div className="mt-1.5 flex items-center justify-between gap-2">
                      {getStatusBadge(transaction)}
                      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        {transaction.receipt_url && <FileText className="h-3.5 w-3.5" aria-label="Receipt attached" />}
                        <ChevronRight className="h-4 w-4" aria-hidden="true" />
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
