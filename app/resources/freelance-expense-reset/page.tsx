import type { Metadata } from 'next';
import ExpenseReset from './expense-reset';

export const metadata: Metadata = {
  title: 'The freelance expense reset',
  description: 'A free checklist to organize freelance expense records, find missing receipts, and prepare clear questions for your accountant.',
  alternates: { canonical: '/resources/freelance-expense-reset' },
};

export default function ExpenseResetPage() {
  return <ExpenseReset />;
}
