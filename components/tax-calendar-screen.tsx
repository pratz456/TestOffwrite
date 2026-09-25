"use client";

import React, { useMemo, useState } from 'react';
import { Bell, AlertTriangle, Clock } from 'lucide-react';
import { SUPPORTED_TAX_YEARS, LATEST_PUBLISHED_TAX_YEAR } from '@/lib/tax-rules/federal-year-rules';
import { getEstimatedTaxDeadline, getIndividualReturnDueDate } from '@/lib/tax-provider/payment-deadlines';
import { AppPageHeader, AppScreenShell, AppSection } from '@/components/app/app-screen-shell';

interface TaxCalendarScreenProps {
  user: {
    id: string;
    email?: string;
    user_metadata?: {
      name?: string;
    };
  };
  onBack: () => void;
}

interface TaxEvent {
  id: string;
  title: string;
  date: string;
  description: string;
  type: 'deadline' | 'reminder' | 'completed';
  priority: 'high' | 'medium' | 'low';
}

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parseCalendarDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function taxCalendarEventsForYear(calendarYear: number): TaxEvent[] {
  const previousTaxYear = calendarYear - 1;
  return [
    {
      id: `${previousTaxYear}-q4`,
      title: `Q4 ${previousTaxYear} Estimated Tax Payment`,
      date: iso(getEstimatedTaxDeadline(previousTaxYear, 4)),
      description: `Fourth estimated-tax installment for tax year ${previousTaxYear}.`,
      type: 'deadline',
      priority: 'high',
    },
    {
      id: `${previousTaxYear}-return`,
      title: `${previousTaxYear} Individual Return Due`,
      date: iso(getIndividualReturnDueDate(previousTaxYear)),
      description: `General federal filing deadline for a calendar-year individual return. Extensions and disaster relief can change it.`,
      type: 'deadline',
      priority: 'high',
    },
    ...([1, 2, 3] as const).map((quarter) => ({
      id: `${calendarYear}-q${quarter}`,
      title: `Q${quarter} ${calendarYear} Estimated Tax Payment`,
      date: iso(getEstimatedTaxDeadline(calendarYear, quarter)),
      description: `Estimated-tax installment ${quarter} for tax year ${calendarYear}.`,
      type: 'deadline' as const,
      priority: quarter === 1 ? 'high' as const : 'medium' as const,
    })),
    {
      id: `${calendarYear}-planning`,
      title: `${calendarYear} Year-End Records Review`,
      date: `${calendarYear}-12-01`,
      description: 'Review transaction categories, receipts, mileage, income records and estimated payments before year end.',
      type: 'reminder',
      priority: 'medium',
    },
  ];
}

export const TaxCalendarScreen: React.FC<TaxCalendarScreenProps> = ({ onBack }) => {
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth());
  const [selectedYear, setSelectedYear] = useState<number>(LATEST_PUBLISHED_TAX_YEAR);
  const taxEvents = useMemo(() => taxCalendarEventsForYear(selectedYear), [selectedYear]);

  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const getEventIcon = (type: string, priority: string) => {
    if (priority === 'high') return <AlertTriangle className="h-5 w-5 text-destructive" />;
    if (type === 'deadline') return <Clock className="h-5 w-5 text-[hsl(var(--warning))]" />;
    return <Bell className="h-5 w-5 text-primary" />;
  };

  const getEventColor = (type: string, priority: string) => {
    if (priority === 'high') return 'border-l-destructive bg-destructive/5';
    if (type === 'deadline') return 'border-l-[hsl(var(--warning))] bg-[hsl(var(--warning)/0.06)]';
    return 'border-l-primary bg-primary/5';
  };

  const upcomingEvents = taxEvents
    .filter(event => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return parseCalendarDate(event.date) >= today;
    })
    .sort((a, b) => parseCalendarDate(a.date).getTime() - parseCalendarDate(b.date).getTime())
    .slice(0, 5);
  const selectedMonthEvents = taxEvents.filter(event => {
    const eventDate = parseCalendarDate(event.date);
    return eventDate.getMonth() === selectedMonth && eventDate.getFullYear() === selectedYear;
  });

  const getDaysUntil = (date: string) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const eventDate = parseCalendarDate(date);
    const diffTime = eventDate.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };
  const daysUntilLabel = (date: string) => {
    const days = getDaysUntil(date);
    if (days === 0) return 'Today';
    if (days === 1) return 'Tomorrow';
    if (days < 0) return `${Math.abs(days)} days ago`;
    return `${days} days`;
  };

  return (
    <AppScreenShell width="wide">
      <AppPageHeader title="Tax calendar" description="Federal filing and estimated-payment dates for the selected year." onBack={onBack} />
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          {/* Upcoming Events */}
          <div className="space-y-3 lg:col-span-2">
            <AppSection title="Upcoming deadlines" description="Standard federal dates; disaster relief and individual extensions can change them.">
              <div className="space-y-2">
                {upcomingEvents.length === 0 && (
                  <p className="text-sm text-muted-foreground">No remaining listed deadlines in {selectedYear}. Select another year to review its dates.</p>
                )}
                {upcomingEvents.map((event) => {
                  const daysUntil = getDaysUntil(event.date);
                  return (
                    <div
                      key={event.id}
                      className={`rounded-lg border-l-4 p-3 ${getEventColor(event.type, event.priority)}`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-start gap-3">
                          {getEventIcon(event.type, event.priority)}
                          <div>
                            <h4 className="text-sm font-medium text-foreground">{event.title}</h4>
                            <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{event.description}</p>
                            <div className="mt-1.5 flex flex-wrap items-center gap-2">
                              <span className="text-xs font-medium text-foreground">
                                {parseCalendarDate(event.date).toLocaleDateString('en-US', {
                                  weekday: 'long',
                                  year: 'numeric',
                                  month: 'long',
                                  day: 'numeric'
                                })}
                              </span>
                              <span className={`text-xs px-2 py-1 rounded-full ${
                                daysUntil <= 7 ? 'bg-destructive/10 text-destructive' :
                                daysUntil <= 30 ? 'bg-[hsl(var(--warning)/0.12)] text-[hsl(var(--warning))]' :
                                'bg-primary/10 text-primary'
                              }`}>
                                {daysUntilLabel(event.date)}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </AppSection>

            {/* All Events by Month */}
            <AppSection title="Browse by month" actions={
                <div className="flex items-center gap-2">
                  <select
                    value={selectedMonth}
                    onChange={(e) => setSelectedMonth(parseInt(e.target.value))}
                    aria-label="Month"
                    className="min-h-11 rounded-md border border-input bg-background px-3 text-sm"
                  >
                    {months.map((month, index) => (
                      <option key={month} value={index}>{month}</option>
                    ))}
                  </select>
                  <select
                    value={selectedYear}
                    onChange={(e) => setSelectedYear(parseInt(e.target.value))}
                    aria-label="Year"
                    className="min-h-11 rounded-md border border-input bg-background px-3 text-sm"
                  >
                    {SUPPORTED_TAX_YEARS.map(year => <option key={year} value={year}>{year}</option>)}
                  </select>
                </div>
              }>

              <div className="space-y-3">
                {selectedMonthEvents.length === 0 && (
                  <p className="rounded-lg bg-muted/30 p-3 text-sm text-muted-foreground">
                    No standard federal deadline is listed for {months[selectedMonth]} {selectedYear}.
                  </p>
                )}
                {selectedMonthEvents.map((event) => (
                    <div key={event.id} className="flex min-h-14 items-center justify-between gap-3 rounded-lg bg-muted/40 p-3">
                      <div className="flex items-center gap-3">
                        {getEventIcon(event.type, event.priority)}
                        <div>
                          <p className="text-sm font-medium text-foreground">{event.title}</p>
                          <p className="text-xs text-muted-foreground">{parseCalendarDate(event.date).toLocaleDateString()}</p>
                        </div>
                      </div>
                      <span className={`text-xs px-2 py-1 rounded-full ${
                        event.priority === 'high' ? 'bg-destructive/10 text-destructive' :
                        event.priority === 'medium' ? 'bg-[hsl(var(--warning)/0.12)] text-[hsl(var(--warning))]' :
                        'bg-primary/10 text-primary'
                      }`}>
                        {event.priority}
                      </span>
                    </div>
                  ))}
              </div>
            </AppSection>
          </div>

          {/* Sidebar */}
          <div className="space-y-3">
            {/* Quick Stats */}
            <AppSection title="Year overview">
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Filing deadline</span>
                  <span className="font-semibold text-destructive">
                    {daysUntilLabel(iso(getIndividualReturnDueDate(selectedYear - 1)))}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">High priority</span>
                  <span className="font-semibold text-[hsl(var(--warning))]">{taxEvents.filter(event => event.priority === 'high').length} items</span>
                </div>
              </div>
            </AppSection>

            {/* Tax Tips */}
            <AppSection className="border-primary/20 bg-primary/5">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Planning note</h3>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Consider making quarterly estimated tax payments to avoid penalties and manage your cash flow better throughout the year.
                </p>
              </div>
            </AppSection>

          </div>
        </div>
    </AppScreenShell>
  );
};
