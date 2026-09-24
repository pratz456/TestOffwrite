"use client";

import React, { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Bell, AlertTriangle, Clock } from 'lucide-react';
import { SUPPORTED_TAX_YEARS, LATEST_PUBLISHED_TAX_YEAR } from '@/lib/tax-rules/federal-year-rules';
import { getEstimatedTaxDeadline, getIndividualReturnDueDate } from '@/lib/tax-provider/payment-deadlines';

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
    if (priority === 'high') return <AlertTriangle className="w-5 h-5 text-red-600" />;
    if (type === 'deadline') return <Clock className="w-5 h-5 text-orange-600" />;
    return <Bell className="w-5 h-5 text-blue-600" />;
  };

  const getEventColor = (type: string, priority: string) => {
    if (priority === 'high') return 'border-l-red-500 bg-red-50';
    if (type === 'deadline') return 'border-l-orange-500 bg-orange-50';
    return 'border-l-blue-500 bg-blue-50';
  };

  const upcomingEvents = taxEvents
    .filter(event => new Date(event.date) >= new Date())
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .slice(0, 5);

  const getDaysUntil = (date: string) => {
    const today = new Date();
    const eventDate = new Date(date);
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
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
      {/* Header */}
      <div className="bg-white border-b border-blue-100 sticky top-0 z-50 shadow-sm">
        <div className="max-w-6xl mx-auto px-6 py-4">
          <div className="flex items-center gap-4">
            <Button variant="outline" size="sm" onClick={onBack}>Back</Button>
            <div>
              <h1 className="text-xl font-semibold text-slate-900">Tax Calendar</h1>
              <p className="text-sm text-slate-600">Important tax dates and deadlines</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto p-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Upcoming Events */}
          <div className="lg:col-span-2 space-y-6">
            <Card className="p-6 bg-white border-0 shadow-xl">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-semibold text-slate-900">Upcoming Deadlines</h3>
              </div>

              <div className="space-y-4">
                {upcomingEvents.length === 0 && (
                  <p className="text-sm text-slate-600">No remaining listed deadlines in {selectedYear}. Select another year to review its dates.</p>
                )}
                {upcomingEvents.map((event) => {
                  const daysUntil = getDaysUntil(event.date);
                  return (
                    <div
                      key={event.id}
                      className={`p-4 rounded-lg border-l-4 ${getEventColor(event.type, event.priority)}`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-start gap-3">
                          {getEventIcon(event.type, event.priority)}
                          <div>
                            <h4 className="font-medium text-slate-900">{event.title}</h4>
                            <p className="text-sm text-slate-600 mt-1">{event.description}</p>
                            <div className="flex items-center gap-4 mt-2">
                              <span className="text-sm font-medium text-slate-700">
                                {new Date(event.date).toLocaleDateString('en-US', {
                                  weekday: 'long',
                                  year: 'numeric',
                                  month: 'long',
                                  day: 'numeric'
                                })}
                              </span>
                              <span className={`text-xs px-2 py-1 rounded-full ${
                                daysUntil <= 7 ? 'bg-red-100 text-red-700' :
                                daysUntil <= 30 ? 'bg-orange-100 text-orange-700' :
                                'bg-blue-100 text-blue-700'
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
            </Card>

            {/* All Events by Month */}
            <Card className="p-6 bg-white border-0 shadow-xl">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-semibold text-slate-900">All Tax Events</h3>
                <div className="flex items-center gap-2">
                  <select
                    value={selectedMonth}
                    onChange={(e) => setSelectedMonth(parseInt(e.target.value))}
                    className="px-3 py-1 border border-gray-300 rounded-md text-sm"
                  >
                    {months.map((month, index) => (
                      <option key={month} value={index}>{month}</option>
                    ))}
                  </select>
                  <select
                    value={selectedYear}
                    onChange={(e) => setSelectedYear(parseInt(e.target.value))}
                    className="px-3 py-1 border border-gray-300 rounded-md text-sm"
                  >
                    {SUPPORTED_TAX_YEARS.map(year => <option key={year} value={year}>{year}</option>)}
                  </select>
                </div>
              </div>

              <div className="space-y-3">
                {taxEvents
                  .filter(event => {
                    const eventDate = new Date(event.date);
                    return eventDate.getMonth() === selectedMonth && eventDate.getFullYear() === selectedYear;
                  })
                  .map((event) => (
                    <div key={event.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                      <div className="flex items-center gap-3">
                        {getEventIcon(event.type, event.priority)}
                        <div>
                          <p className="font-medium text-slate-900">{event.title}</p>
                          <p className="text-sm text-slate-600">{new Date(event.date).toLocaleDateString()}</p>
                        </div>
                      </div>
                      <span className={`text-xs px-2 py-1 rounded-full ${
                        event.priority === 'high' ? 'bg-red-100 text-red-700' :
                        event.priority === 'medium' ? 'bg-orange-100 text-orange-700' :
                        'bg-blue-100 text-blue-700'
                      }`}>
                        {event.priority}
                      </span>
                    </div>
                  ))}
              </div>
            </Card>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Quick Stats */}
            <Card className="p-6 bg-white border-0 shadow-xl">
              <h3 className="text-lg font-semibold text-slate-900 mb-4">Tax Year Overview</h3>
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-slate-600">Days until filing deadline</span>
                  <span className="font-bold text-red-600">
                    {daysUntilLabel(iso(getIndividualReturnDueDate(selectedYear - 1)))}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-slate-600">High Priority</span>
                  <span className="font-bold text-orange-600">{taxEvents.filter(event => event.priority === 'high').length} items</span>
                </div>
              </div>
            </Card>

            {/* Tax Tips */}
            <Card className="p-6 bg-gradient-to-br from-blue-600 to-blue-700 border-0 shadow-xl text-white">
              <div className="mb-4">
                <h3 className="text-lg font-semibold mb-2">💡 Tax Planning Tip</h3>
                <p className="text-sm text-blue-100">
                  Consider making quarterly estimated tax payments to avoid penalties and manage your cash flow better throughout the year.
                </p>
              </div>
              <Button size="sm" variant="secondary" className="w-full">
                Learn More
              </Button>
            </Card>

          </div>
        </div>
      </div>
    </div>
  );
};
