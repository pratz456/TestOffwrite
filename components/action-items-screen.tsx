'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  ArrowLeft,
  ArrowRight,
  AlertTriangle,
  CheckCircle2,
  Landmark,
  Briefcase,
  UserCheck,
  MapPin,
  DollarSign,
  Brain,
  ClipboardCheck,
  Home,
  Car,
  Route,
  Receipt,
  FileText,
  CalendarCheck,
  Tags,
  X,
  Shield,
  TrendingUp,
  Settings,
  FolderCheck,
} from 'lucide-react';
import { auth } from '@/lib/firebase/client';
import {
  generateActionItems,
  getActionsByCategory,
  type ActionItem,
  type ActionPriority,
  type ActionCategory,
} from '@/lib/guidance/action-engine';

const ICON_MAP: Record<string, React.ElementType> = {
  Landmark,
  Briefcase,
  UserCheck,
  MapPin,
  DollarSign,
  Brain,
  ClipboardCheck,
  Home,
  Car,
  Route,
  Receipt,
  FileText,
  CalendarCheck,
  Tags,
  AlertTriangle,
};

const CATEGORY_META: Record<ActionCategory, { label: string; icon: React.ElementType; description: string }> = {
  setup: {
    label: 'Setup & Profile',
    icon: Settings,
    description: 'Complete your profile so we can personalize your experience',
  },
  review: {
    label: 'Transaction Review',
    icon: ClipboardCheck,
    description: 'Review and confirm AI-classified transactions',
  },
  tax_optimization: {
    label: 'Tax Optimization',
    icon: TrendingUp,
    description: 'Opportunities to maximize your deductions',
  },
  filing: {
    label: 'Filing Readiness',
    icon: FolderCheck,
    description: 'Get everything ready for tax filing',
  },
  compliance: {
    label: 'Compliance & Deadlines',
    icon: Shield,
    description: 'Stay compliant and never miss a deadline',
  },
  financial_health: {
    label: 'Financial Health',
    icon: TrendingUp,
    description: 'Keep your financial data clean and organized',
  },
};

const PRIORITY_STYLES: Record<
  ActionPriority,
  { dot: string; badge: 'destructive' | 'warning' | 'secondary' | 'outline'; border: string; bg: string }
> = {
  critical: { dot: 'bg-destructive', badge: 'destructive', border: 'border-destructive/20', bg: 'bg-destructive/5' },
  high: { dot: 'bg-[hsl(var(--chart-4))]', badge: 'warning', border: 'border-[hsl(var(--chart-4)/0.2)]', bg: 'bg-[hsl(var(--chart-4)/0.05)]' },
  medium: { dot: 'bg-primary', badge: 'secondary', border: 'border-primary/15', bg: 'bg-primary/5' },
  low: { dot: 'bg-muted-foreground', badge: 'outline', border: 'border-border', bg: 'bg-muted/30' },
};

interface ActionItemsScreenProps {
  user: { id: string; email?: string };
  onBack: () => void;
  onNavigate: (screen: string) => void;
  profile?: any;
  transactions?: any[];
}

export function ActionItemsScreen({
  user,
  onBack,
  onNavigate,
  profile,
  transactions = [],
}: ActionItemsScreenProps) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [items, setItems] = useState<ActionItem[]>([]);
  const [options, setOptions] = useState<{
    has1099Forms?: boolean;
    hasMileageTrips?: boolean;
    hasQuarterlyPayments?: boolean;
  }>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem('writeoff_dismissed_actions');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) setDismissed(new Set(parsed));
      } catch { /* ignore */ }
    }
  }, []);

  useEffect(() => {
    async function fetchExtras() {
      try {
        const token = await auth.currentUser?.getIdToken();
        if (!token) {
          setLoading(false);
          return;
        }
        const headers = { Authorization: `Bearer ${token}` };

        const [income1099Res, mileageRes, quarterlyRes] = await Promise.all([
          fetch('/api/income/1099', { headers }).catch(() => null),
          fetch('/api/mileage', { headers }).catch(() => null),
          fetch('/api/tax/quarterly-payments', { headers }).catch(() => null),
        ]);

        const newOpts: typeof options = {};
        if (income1099Res?.ok) {
          const data = await income1099Res.json();
          newOpts.has1099Forms = Array.isArray(data.forms) && data.forms.length > 0;
        }
        if (mileageRes?.ok) {
          const data = await mileageRes.json();
          newOpts.hasMileageTrips = Array.isArray(data.trips) && data.trips.length > 0;
        }
        if (quarterlyRes?.ok) {
          const data = await quarterlyRes.json();
          newOpts.hasQuarterlyPayments =
            Array.isArray(data.quarters) && data.quarters.some((q: any) => q.amountPaid > 0);
        }
        setOptions(newOpts);
      } catch {
        // non-critical
      } finally {
        setLoading(false);
      }
    }
    fetchExtras();
  }, [user.id]);

  useEffect(() => {
    const all = generateActionItems(profile, transactions, options);
    setItems(all);
  }, [profile, transactions, options]);

  const handleDismiss = useCallback((id: string) => {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(id);
      localStorage.setItem('writeoff_dismissed_actions', JSON.stringify([...next]));
      return next;
    });
  }, []);

  const handleUndismiss = useCallback((id: string) => {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.delete(id);
      localStorage.setItem('writeoff_dismissed_actions', JSON.stringify([...next]));
      return next;
    });
  }, []);

  const activeItems = items.filter((i) => !dismissed.has(i.id));
  const dismissedItems = items.filter((i) => dismissed.has(i.id));
  const completionPct = items.length > 0 ? Math.round((dismissedItems.length / items.length) * 100) : 100;
  const grouped = getActionsByCategory(activeItems);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/80 backdrop-blur-xl border-b border-border">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onBack} className="h-9 w-9 p-0">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1">
            <h1 className="text-base font-semibold text-foreground">Action Items</h1>
            <p className="text-xs text-muted-foreground">
              {activeItems.length === 0
                ? 'All caught up!'
                : `${activeItems.length} item${activeItems.length === 1 ? '' : 's'} need your attention`}
            </p>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-5 space-y-6">
        {/* Progress */}
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-foreground">Your progress</span>
            <span className="text-sm font-semibold text-foreground">{completionPct}%</span>
          </div>
          <Progress value={completionPct} className="mb-2" />
          <p className="text-xs text-muted-foreground">
            {dismissedItems.length} of {items.length} items completed or dismissed
          </p>
        </div>

        {loading && (
          <div className="text-center py-8 text-sm text-muted-foreground">
            Checking your account...
          </div>
        )}

        {!loading && activeItems.length === 0 && (
          <div className="text-center py-12 space-y-3">
            <div className="w-14 h-14 mx-auto rounded-full bg-green-500/10 flex items-center justify-center">
              <CheckCircle2 className="h-7 w-7 text-green-500" />
            </div>
            <h2 className="text-lg font-semibold text-foreground">You're all set!</h2>
            <p className="text-sm text-muted-foreground max-w-xs mx-auto">
              No action items right now. We'll notify you when something needs your attention.
            </p>
          </div>
        )}

        {/* Grouped sections */}
        {!loading &&
          (Object.entries(grouped) as [ActionCategory, ActionItem[]][])
            .filter(([, catItems]) => catItems.length > 0)
            .map(([category, catItems]) => {
              const meta = CATEGORY_META[category];
              const CatIcon = meta.icon;

              return (
                <div key={category} className="space-y-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-md bg-muted flex items-center justify-center">
                      <CatIcon className="h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">{meta.label}</h3>
                      <p className="text-[11px] text-muted-foreground">{meta.description}</p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {catItems.map((item) => {
                      const style = PRIORITY_STYLES[item.priority];
                      const Icon = ICON_MAP[item.icon] || AlertTriangle;

                      return (
                        <div
                          key={item.id}
                          className={`rounded-lg border ${style.border} ${style.bg} p-3.5 sm:p-4 transition-colors`}
                        >
                          <div className="flex items-start gap-3">
                            <div className="w-8 h-8 rounded-lg bg-background/60 flex items-center justify-center shrink-0 mt-0.5">
                              <Icon className="h-4 w-4 text-muted-foreground" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-0.5">
                                <div className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />
                                <Badge variant={style.badge} className="text-[10px]">
                                  {item.priority}
                                </Badge>
                              </div>
                              <p className="text-sm font-medium text-foreground leading-snug mb-0.5">
                                {item.title}
                              </p>
                              <p className="text-xs text-muted-foreground leading-relaxed mb-2">
                                {item.description}
                              </p>
                              <div className="flex items-center gap-2 flex-wrap">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => onNavigate(item.screen)}
                                  className="h-8 px-3 text-xs font-medium text-primary hover:bg-primary/10"
                                >
                                  Go fix this
                                  <ArrowRight className="h-3 w-3 ml-1" />
                                </Button>
                                <button
                                  type="button"
                                  onClick={() => handleDismiss(item.id)}
                                  className="h-8 px-2 inline-flex items-center gap-1 rounded-md text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
                                >
                                  <X className="h-3 w-3" />
                                  Dismiss
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}

        {/* Dismissed items */}
        {dismissedItems.length > 0 && (
          <div className="space-y-3 pt-2">
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Dismissed ({dismissedItems.length})
            </h3>
            <div className="space-y-1.5">
              {dismissedItems.map((item) => {
                const Icon = ICON_MAP[item.icon] || AlertTriangle;
                return (
                  <div
                    key={item.id}
                    className="rounded-lg border border-border/50 bg-muted/20 p-3 flex items-center gap-3 opacity-60 hover:opacity-80 transition-opacity"
                  >
                    <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="text-xs text-muted-foreground flex-1 line-through">
                      {item.title}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleUndismiss(item.id)}
                      className="text-[11px] text-primary hover:underline shrink-0"
                    >
                      Undo
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
