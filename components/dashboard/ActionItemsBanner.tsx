'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  ChevronRight,
  AlertTriangle,
  ArrowRight,
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
} from 'lucide-react';
import {
  generateActionItems,
  getTopActionItem,
  type ActionItem,
  type ActionPriority,
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

const PRIORITY_STYLES: Record<ActionPriority, { border: string; bg: string; badge: 'destructive' | 'warning' | 'secondary' | 'outline'; text: string }> = {
  critical: {
    border: 'border-destructive/30',
    bg: 'bg-destructive/5',
    badge: 'destructive',
    text: 'text-destructive',
  },
  high: {
    border: 'border-[hsl(var(--chart-4)/0.3)]',
    bg: 'bg-[hsl(var(--chart-4)/0.06)]',
    badge: 'warning',
    text: 'text-[hsl(var(--chart-4))]',
  },
  medium: {
    border: 'border-primary/20',
    bg: 'bg-primary/5',
    badge: 'secondary',
    text: 'text-primary',
  },
  low: {
    border: 'border-border',
    bg: 'bg-muted/30',
    badge: 'outline',
    text: 'text-muted-foreground',
  },
};

interface ActionItemsBannerProps {
  profile: any;
  transactions: any[];
  onNavigate: (screen: string) => void;
  options?: {
    has1099Forms?: boolean;
    hasMileageTrips?: boolean;
    hasQuarterlyPayments?: boolean;
  };
}

export function ActionItemsBanner({ profile, transactions, onNavigate, options }: ActionItemsBannerProps) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [items, setItems] = useState<ActionItem[]>([]);

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
    const all = generateActionItems(profile, transactions, options);
    const visible = all.filter((i) => !dismissed.has(i.id));
    setItems(visible);
  }, [profile, transactions, options, dismissed]);

  const handleDismiss = useCallback((id: string) => {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(id);
      localStorage.setItem('writeoff_dismissed_actions', JSON.stringify([...next]));
      return next;
    });
  }, []);

  if (items.length === 0) return null;

  const top = items[0];
  const remainingCount = items.length - 1;
  const style = PRIORITY_STYLES[top.priority];
  const Icon = ICON_MAP[top.icon] || AlertTriangle;

  return (
    <div className={`rounded-xl border ${style.border} ${style.bg} backdrop-blur-sm p-4 sm:p-5 shadow-sm`}>
      {/* Top item */}
      <div className="flex items-start gap-3.5">
        <div className={`w-9 h-9 rounded-lg ${style.bg} flex items-center justify-center shrink-0 mt-0.5`}>
          <Icon className={`h-4.5 w-4.5 ${style.text}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Badge variant={style.badge} className="text-[10px] uppercase tracking-wider">
              {top.priority === 'critical' ? 'Action Required' : top.priority === 'high' ? 'Recommended' : 'Suggestion'}
            </Badge>
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
              {top.category.replace('_', ' ')}
            </span>
          </div>
          <p className="text-sm font-semibold text-foreground leading-snug mb-1">
            {top.title}
          </p>
          <p className="text-xs text-muted-foreground leading-relaxed mb-2.5">
            {top.description}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onNavigate(top.screen)}
              className={`min-h-[44px] sm:min-h-0 -ml-3 h-11 sm:h-8 px-3 text-xs font-medium ${style.text} hover:bg-black/5 dark:hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`}
            >
              Go to {top.screen.replace(/-/g, ' ')}
              <ArrowRight className="h-3.5 w-3.5 ml-1" />
            </Button>
            <button
              type="button"
              onClick={() => handleDismiss(top.id)}
              className="h-8 w-8 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
              aria-label="Dismiss this action item"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Remaining count */}
      {remainingCount > 0 && (
        <button
          type="button"
          onClick={() => onNavigate('action-items')}
          className="mt-3 pt-3 border-t border-border/50 w-full flex items-center justify-between text-xs text-muted-foreground hover:text-foreground transition-colors group"
        >
          <span>
            <span className="font-medium">{remainingCount} more</span>{' '}
            {remainingCount === 1 ? 'action item' : 'action items'} to review
          </span>
          <ChevronRight className="h-3.5 w-3.5 group-hover:translate-x-0.5 transition-transform" />
        </button>
      )}
    </div>
  );
}
