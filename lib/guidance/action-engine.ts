/**
 * Proactive Action Items Engine
 *
 * Evaluates the user's profile, transactions, and app usage to generate
 * prioritized action items that guide them through setup, tax optimization,
 * and filing readiness.
 */

export type ActionPriority = 'critical' | 'high' | 'medium' | 'low';
export type ActionCategory =
  | 'setup'
  | 'review'
  | 'tax_optimization'
  | 'filing'
  | 'compliance'
  | 'financial_health';

export interface ActionItem {
  id: string;
  title: string;
  description: string;
  priority: ActionPriority;
  category: ActionCategory;
  screen: string;
  icon: string; // lucide icon name
  dismissed?: boolean;
  completedCheck?: string; // key used to mark as done
}

interface UserProfile {
  name?: string;
  profession?: string | string[];
  state?: string;
  filing_status?: string;
  business_entity_type?: string;
  home_office_sqft?: number;
  total_home_sqft?: number;
  vehicle_business_use_percentage?: number;
  business_income?: number;
  w2_income?: number;
  annual_gross_income_usd?: number;
  plaidToken?: string;
  plaid_accounts?: any[];
  [key: string]: any;
}

interface Transaction {
  id?: string;
  analysis_status?: string;
  analyzed?: boolean;
  is_deductible?: boolean;
  category?: string;
  amount?: number;
  date?: string;
  merchant_name?: string;
  receipt_url?: string;
  receipt_filename?: string;
  [key: string]: any;
}

const PRIORITY_ORDER: Record<ActionPriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export function generateActionItems(
  profile: UserProfile | null,
  transactions: Transaction[],
  options?: {
    has1099Forms?: boolean;
    hasMileageTrips?: boolean;
    hasQuarterlyPayments?: boolean;
  }
): ActionItem[] {
  const items: ActionItem[] = [];
  const opts = options || {};

  // ── Setup & Onboarding ──────────────────────────────────────

  if (!profile?.plaidToken && (!profile?.plaid_accounts || profile.plaid_accounts.length === 0)) {
    items.push({
      id: 'connect-bank',
      title: 'Connect your bank account',
      description:
        'Link a bank or credit card so transactions import automatically. This is the foundation for tracking deductions.',
      priority: 'critical',
      category: 'setup',
      screen: 'plaid-link',
      icon: 'Landmark',
    });
  }

  if (!profile?.profession || (Array.isArray(profile.profession) && profile.profession.length === 0)) {
    items.push({
      id: 'set-profession',
      title: 'Add your profession',
      description:
        'Tell us what you do so the AI can give profession-specific deduction advice.',
      priority: 'critical',
      category: 'setup',
      screen: 'settings',
      icon: 'Briefcase',
    });
  }

  if (!profile?.filing_status) {
    items.push({
      id: 'set-filing-status',
      title: 'Set your filing status',
      description:
        'Your filing status affects tax brackets, standard deduction, and quarterly estimates.',
      priority: 'high',
      category: 'setup',
      screen: 'settings',
      icon: 'UserCheck',
    });
  }

  if (!profile?.state) {
    items.push({
      id: 'set-state',
      title: 'Set your state',
      description:
        'We need your state to calculate state taxes and give state-specific advice.',
      priority: 'high',
      category: 'setup',
      screen: 'settings',
      icon: 'MapPin',
    });
  }

  const hasIncome =
    (profile?.business_income && profile.business_income > 0) ||
    (profile?.annual_gross_income_usd && profile.annual_gross_income_usd > 0);
  if (!hasIncome) {
    items.push({
      id: 'set-income',
      title: 'Enter your income estimate',
      description:
        'An income estimate helps calculate quarterly tax payments and effective tax rates accurately.',
      priority: 'high',
      category: 'setup',
      screen: 'settings',
      icon: 'DollarSign',
    });
  }

  // ── Transaction Review ──────────────────────────────────────

  const pendingAnalysis = transactions.filter(
    (t) => t.analysis_status === 'pending' || (!t.analyzed && !t.analysis_status)
  );
  if (pendingAnalysis.length > 0) {
    items.push({
      id: 'analyze-transactions',
      title: `${pendingAnalysis.length} transactions need AI analysis`,
      description:
        'These transactions haven\'t been classified yet. Analyze them to identify deductions.',
      priority: pendingAnalysis.length > 20 ? 'critical' : 'high',
      category: 'review',
      screen: 'review-transactions',
      icon: 'Brain',
    });
  }

  const analyzedNotReviewed = transactions.filter(
    (t) =>
      t.analyzed === true &&
      t.analysis_status !== 'confirmed' &&
      t.analysis_status !== 'rejected'
  );
  if (analyzedNotReviewed.length > 0) {
    items.push({
      id: 'review-analyzed',
      title: `${analyzedNotReviewed.length} analyzed transactions to review`,
      description:
        'The AI has classified these. Confirm or correct them to keep your deductions accurate.',
      priority: analyzedNotReviewed.length > 10 ? 'high' : 'medium',
      category: 'review',
      screen: 'review-transactions',
      icon: 'ClipboardCheck',
    });
  }

  // ── Tax Optimization ────────────────────────────────────────

  if (profile?.home_office_sqft && profile.home_office_sqft > 0 && !profile?.total_home_sqft) {
    items.push({
      id: 'complete-home-office',
      title: 'Complete your home office details',
      description:
        'You entered home office square footage but not total home size. We need both to calculate the Form 8829 deduction.',
      priority: 'medium',
      category: 'tax_optimization',
      screen: 'settings',
      icon: 'Home',
    });
  }

  const hasVehicleExpenses = transactions.some(
    (t) => t.category === 'vehicle_expense' || t.category === 'gas'
  );
  if (hasVehicleExpenses && !opts.hasMileageTrips) {
    items.push({
      id: 'track-mileage',
      title: 'Start tracking your mileage',
      description:
        'You have vehicle expenses but no mileage log. The IRS standard mileage deduction ($0.67/mile) often saves more than actual expenses.',
      priority: 'high',
      category: 'tax_optimization',
      screen: 'mileage-tracker',
      icon: 'Car',
    });
  }

  if (profile?.vehicle_business_use_percentage && profile.vehicle_business_use_percentage > 0 && !opts.hasMileageTrips) {
    items.push({
      id: 'log-mileage',
      title: 'Log your business mileage',
      description:
        `You use your vehicle ${profile.vehicle_business_use_percentage}% for business. Start logging trips to maximize your deduction.`,
      priority: 'medium',
      category: 'tax_optimization',
      screen: 'mileage-tracker',
      icon: 'Route',
    });
  }

  // Large expenses without receipts
  const largeNoReceipt = transactions.filter(
    (t) =>
      t.is_deductible === true &&
      Math.abs(t.amount || 0) > 75 &&
      !t.receipt_url &&
      !t.receipt_filename
  );
  if (largeNoReceipt.length > 0) {
    items.push({
      id: 'attach-receipts',
      title: `${largeNoReceipt.length} deductions over $75 need receipts`,
      description:
        'The IRS requires receipts for expenses over $75. Upload them now to protect your deductions in case of audit.',
      priority: 'high',
      category: 'compliance',
      screen: 'receipt-upload',
      icon: 'Receipt',
    });
  }

  // ── Filing Readiness ────────────────────────────────────────

  if (!opts.has1099Forms && hasIncome) {
    items.push({
      id: 'add-1099-forms',
      title: 'Add your 1099 income forms',
      description:
        'Track your 1099-NEC, 1099-K, and other income forms so your tax return has complete income reporting.',
      priority: 'medium',
      category: 'filing',
      screen: 'income-tracking',
      icon: 'FileText',
    });
  }

  if (!opts.hasQuarterlyPayments && hasIncome) {
    items.push({
      id: 'track-quarterly-payments',
      title: 'Track your quarterly tax payments',
      description:
        'Record any estimated tax payments you\'ve made to avoid underpayment penalties.',
      priority: 'medium',
      category: 'filing',
      screen: 'quarterly-payments',
      icon: 'CalendarCheck',
    });
  }

  // ── Quarterly deadline proximity ────────────────────────────

  const now = new Date();
  const year = now.getFullYear();
  const deadlines = [
    { q: 1, date: new Date(year, 3, 15) },
    { q: 2, date: new Date(year, 5, 15) },
    { q: 3, date: new Date(year, 8, 15) },
    { q: 4, date: new Date(year + 1, 0, 15) },
  ];
  const nextDeadline = deadlines.find((d) => d.date > now);
  if (nextDeadline) {
    const daysUntil = Math.ceil(
      (nextDeadline.date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    );
    if (daysUntil <= 14 && daysUntil > 0) {
      items.push({
        id: 'quarterly-deadline-soon',
        title: `Q${nextDeadline.q} estimated tax payment due in ${daysUntil} days`,
        description:
          `Your quarterly estimated tax payment is due ${nextDeadline.date.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}. Pay on time to avoid penalties.`,
        priority: daysUntil <= 3 ? 'critical' : 'high',
        category: 'compliance',
        screen: 'quarterly-payments',
        icon: 'AlertTriangle',
      });
    }
  }

  // ── Financial Health ────────────────────────────────────────

  const currentYearTx = transactions.filter((t) => {
    const txYear = t.date ? new Date(t.date).getFullYear() : 0;
    return txYear === year;
  });
  if (currentYearTx.length > 50) {
    const uncategorized = currentYearTx.filter(
      (t) => !t.category || t.category === 'other' || t.category === 'uncategorized'
    );
    const uncatPct = uncategorized.length / currentYearTx.length;
    if (uncatPct > 0.3) {
      items.push({
        id: 'categorize-transactions',
        title: `${uncategorized.length} transactions need categories`,
        description:
          'Over 30% of your transactions are uncategorized. Proper categorization ensures accurate Schedule C reporting.',
        priority: 'medium',
        category: 'financial_health',
        screen: 'review-transactions',
        icon: 'Tags',
      });
    }
  }

  // Sort by priority
  items.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);

  return items;
}

export function getTopActionItem(items: ActionItem[]): ActionItem | null {
  const undismissed = items.filter((i) => !i.dismissed);
  return undismissed[0] || null;
}

export function getActionsByCategory(
  items: ActionItem[]
): Record<ActionCategory, ActionItem[]> {
  const grouped: Record<ActionCategory, ActionItem[]> = {
    setup: [],
    review: [],
    tax_optimization: [],
    filing: [],
    compliance: [],
    financial_health: [],
  };
  for (const item of items) {
    grouped[item.category].push(item);
  }
  return grouped;
}
