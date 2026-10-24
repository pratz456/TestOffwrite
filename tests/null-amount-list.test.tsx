import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { RecentActivityCard } from '@/components/dashboard/RecentActivityCard';
import { ExpensesDetailScreen } from '@/components/expenses-detail-screen';
import { formatListAmount, formatSignedListAmount } from '@/lib/transactions/amount-display';

describe('list screens with a null amount', () => {
  it('shows Amount needed instead of $0.00', () => {
    expect(formatListAmount(null)).toBe('Amount needed');
    expect(formatListAmount(12.5)).toBe('$12.50');
    expect(formatSignedListAmount(null, false)).toBe('Amount needed');
    expect(formatSignedListAmount(12.5, false)).toBe('-$12.50');
    expect(formatSignedListAmount(12.5, true)).toBe('+$12.50');

    const recent = renderToStaticMarkup(
      <RecentActivityCard
        transactions={[{ id: 'blank', merchant_name: 'Blank Market', amount: null, category: 'office_expense', date: '2026-06-15', iso_currency_code: 'USD' }]}
        onTransactionClick={() => {}}
        onViewAll={() => {}}
      />,
    );
    expect(recent).toContain('Amount needed');
    expect(recent).not.toContain('$0.00');
    expect(recent).not.toContain('-Amount needed');

    const expenses = renderToStaticMarkup(
      <ExpensesDetailScreen
        user={{ id: 'owner' }}
        onBack={() => {}}
        transactions={[{ id: 'blank', merchant_name: 'Blank Market', description: 'Blank Market', amount: null as unknown as number, category: 'office', date: '2026-06-15', type: 'expense' }]}
      />,
    );
    expect(expenses).toContain('Blank Market');
    expect(expenses).toContain('Amount needed');
    expect(expenses).not.toContain('$0.00');
  });
});
