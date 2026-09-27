import { getEstimatedTaxDeadline, getIndividualReturnDueDate } from '@/lib/tax-provider/payment-deadlines';

export interface TaxCalendarEvent {
  id: string;
  title: string;
  date: string;
  description: string;
  type: 'deadline' | 'reminder';
  priority: 'high' | 'medium';
}

const iso = (date: Date) => date.toISOString().slice(0, 10);

export function taxCalendarEventsForYear(calendarYear: number): TaxCalendarEvent[] {
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
      description: 'General federal filing deadline for a calendar-year individual return. Extensions and disaster relief can change it.',
      type: 'deadline',
      priority: 'high',
    },
    ...([1, 2, 3] as const).map(quarter => ({
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
