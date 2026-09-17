import { Home, CreditCard, Eye, Sparkles, TrendingUp, Minus, FolderOpen, ClipboardCheck, Briefcase, PenLine, BarChart3, Calculator, ListChecks, CalendarDays, Settings, type LucideIcon } from 'lucide-react';

export interface AppNavigationItem { name: string; href: string; icon: LucideIcon; description: string }

export const PRIMARY_NAVIGATION: AppNavigationItem[] = [
  { name: 'Home', href: '/protected', icon: Home, description: 'Your next steps and recent activity' },
  { name: 'Transactions', href: '/protected/transactions', icon: CreditCard, description: 'Search, review and organize your records' },
  { name: 'Taxes', href: '/protected?screen=tax-preview', icon: Eye, description: 'Understand your federal tax estimate' },
  { name: 'AI assistant', href: '/protected?screen=tax-assistant', icon: Sparkles, description: 'Ask a tax question' },
];

export const RECORD_NAVIGATION: AppNavigationItem[] = [
  { name: 'Income', href: '/protected?screen=income-tracking', icon: TrendingUp, description: 'Business income and 1099 records' },
  { name: 'Deductions', href: '/protected?screen=deductions-entry', icon: Minus, description: 'Health insurance, retirement and HSA' },
  { name: 'Categories', href: '/protected?screen=categories', icon: FolderOpen, description: 'Expense categories and rules' },
  { name: 'Filing & exports', href: '/protected?screen=tax-filing-hub', icon: ClipboardCheck, description: 'Prepare and export for filing' },
];

export const TAX_TOOL_NAVIGATION: AppNavigationItem[] = [
  { name: 'Tax organizer', href: '/protected?screen=tax-organizer', icon: ListChecks, description: 'Complete your household tax facts' },
  { name: 'W-2 income', href: '/protected?screen=w2-income', icon: Briefcase, description: 'Wages from employers' },
  { name: 'Quarterly taxes', href: '/protected?screen=quarterly-taxes', icon: CalendarDays, description: 'Review estimated payments' },
  { name: 'Reports', href: '/protected/reports', icon: BarChart3, description: 'Tax reports and analytics' },
  { name: 'Depreciation (4562)', href: '/protected/form4562', icon: Calculator, description: 'Business assets and depreciation' },
  { name: 'Filing authorization', href: '/protected?screen=form-8879', icon: PenLine, description: 'Provider signatures and historical records' },
];

export const ACCOUNT_NAVIGATION: AppNavigationItem[] = [
  { name: 'Billing and plans', href: '/protected/subscriptions', icon: CreditCard, description: 'Manage your plan' },
  { name: 'Settings', href: '/protected/settings', icon: Settings, description: 'Account and preferences' },
];

export function navigationItemActive(href: string, pathname: string, screen: string | null): boolean {
  if (href === '/protected') return pathname === '/protected' && (!screen || screen === 'dashboard');
  const [path, query] = href.split('?');
  if (query) return pathname === path && screen === new URLSearchParams(query).get('screen');
  return pathname === path || pathname.startsWith(`${path}/`);
}

/** Mobile tabs retain the section context while reviewing an individual record. */
export function primaryNavigationActive(href: string, pathname: string, screen: string | null): boolean {
  if (navigationItemActive(href, pathname, screen)) return true;
  if (href === '/protected/transactions') return pathname === '/protected' && ['transactions', 'transaction-detail', 'review-transactions', 'add-manual-transaction', 'receipt-upload'].includes(screen || '');
  if (href === '/protected?screen=tax-preview') return pathname.startsWith('/protected/form') || pathname === '/protected' && ['tax-preview', 'tax-filing-hub', 'tax-organizer', 'quarterly-taxes', 'w2-income', 'deductions-entry', 'form-8879'].includes(screen || '');
  return false;
}
