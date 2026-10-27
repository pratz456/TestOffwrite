import fs from 'fs';
import path from 'path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { BlogGridClient } from '../components/blog/blog-grid-client';
import { RelatedPosts } from '../components/blog/related-posts';
import { ExpensesDetailScreen } from '../components/expenses-detail-screen';
import { TaxCalendarScreen } from '../components/tax-calendar-screen';
import BlogPostPage from '../app/blog/[slug]/page';
import { formatTransactionDate } from '../lib/transactions/calendar-date';

// Node reads TZ when Date methods run. Set it in this file and assert it took
// effect, because a UTC test process hides the previous-day shift.
const previousTz = process.env.TZ;
process.env.TZ = 'America/Los_Angeles';
afterAll(() => {
  if (previousTz === undefined) delete process.env.TZ;
  else process.env.TZ = previousTz;
});

vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('missing post'); } }));
vi.mock('@/lib/firebase/auth-context', () => ({ useAuth: () => ({ user: null, loading: false }) }));

const DATE_FIELD = 'date|dueDate|publishedAt|deadline|paidDate|authorized_date|statutoryDueDate|reviewedAt';
const DATE_LOCALE_PATTERN = new RegExp(`new Date\\([^)]*\\.(${DATE_FIELD})[^)]*\\)\\.toLocale`);
const INTL_DATE_PATTERN = new RegExp(`new Intl\\.DateTimeFormat\\((?![^)]*timeZone)[^)]*\\)\\.format\\(\\s*new Date\\([^)]*\\.(${DATE_FIELD})`);

/** Full timestamps. The simple date field regex also matches `.datetime`. */
const TIMESTAMP_ALLOWLIST: { file: string; lineIncludes: string }[] = [
  { file: 'components/transaction-detail-screen.tsx', lineIncludes: 'transaction.datetime' },
];

function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(full));
    else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) files.push(full);
  }
  return files;
}

function unzonedDateFormatting(): { violations: string[]; allowed: string[] } {
  const violations: string[] = [];
  const allowed: string[] = [];
  for (const file of [...sourceFiles(path.join(process.cwd(), 'components')), ...sourceFiles(path.join(process.cwd(), 'app'))]) {
    const rel = path.relative(process.cwd(), file);
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, index) => {
      if (!DATE_LOCALE_PATTERN.test(line) && !INTL_DATE_PATTERN.test(line)) return;
      const where = `${rel}:${index + 1}`;
      if (TIMESTAMP_ALLOWLIST.some(entry => entry.file === rel && line.includes(entry.lineIncludes))) allowed.push(where);
      else violations.push(where);
    });
  }
  return { violations, allowed };
}

const gridPost = {
  slug: 'calendar-day',
  title: 'Calendar day',
  description: 'A post dated on the fifteenth.',
  date: '2026-04-15',
  author: 'WriteOff Team',
  tags: ['Tax Deductions'],
  readingTime: 3,
};

function gridMarkup(): string {
  return renderToStaticMarkup(
    <BlogGridClient posts={[gridPost]} tagStyles={{}} tagIcons={{}} />,
  );
}

describe('calendar date display in America/Los_Angeles', () => {
  it('confirms the process time zone is America/Los_Angeles', () => {
    expect(process.env.TZ).toBe('America/Los_Angeles');
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('America/Los_Angeles');
    expect(new Date('2026-04-15').getDate()).toBe(14);
    expect(new Date('2026-04-15').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })).toBe('Tuesday, April 14, 2026');
  });

  it('shows Wednesday, April 15, 2026 for the 2026-04-15 deadline', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 1, 12, 0, 0));
    try {
      const html = renderToStaticMarkup(<TaxCalendarScreen user={{ id: 'synthetic-owner' }} onBack={() => {}} />);
      expect(html).toContain('Wednesday, April 15, 2026');
      expect(html).not.toContain('April 14, 2026');
      expect(html).toContain('4/15/2026');
      expect(html).not.toContain('4/14/2026');
    } finally {
      vi.useRealTimers();
    }
  });

  it('covers 2027-01-15 with the tax calendar weekday format', () => {
    const longDate = { weekday: 'long' as const, year: 'numeric' as const, month: 'long' as const, day: 'numeric' as const };
    expect(new Date('2027-01-15').toLocaleDateString('en-US', longDate)).toBe('Thursday, January 14, 2027');
    expect(formatTransactionDate('2027-01-15', 'en-US', longDate)).toBe('Friday, January 15, 2027');
    expect(formatTransactionDate('2027-01-15')).toBe('1/15/2027');
  });

  it('groups a March 1 transaction under March 2026', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 15, 12, 0, 0));
    try {
      const html = renderToStaticMarkup(
        <ExpensesDetailScreen
          user={{ id: 'synthetic-owner' }}
          onBack={() => {}}
          transactions={[{
            id: 'txn-march-1',
            merchant_name: 'Synthetic supplies',
            description: 'Synthetic supplies',
            amount: 42,
            category: 'office_expense',
            date: '2026-03-01',
            type: 'expense',
            is_deductible: true,
          }]}
        />,
      );
      expect(html).toContain('Mar 2026');
      expect(html).not.toContain('Feb 2026');
      expect(html).toContain('3/1/2026');
      expect(html).not.toContain('2/28/2026');
    } finally {
      vi.useRealTimers();
    }
  });

  it('displays a front matter date of 2026-04-15 as April 15', async () => {
    const html = renderToStaticMarkup(await BlogPostPage({ params: Promise.resolve({ slug: 'gig-economy-tax-guide' }) }));
    expect(html).toContain('April 15, 2026');
    expect(html).not.toContain('April 14, 2026');
  });

  it('keeps the blog grid calendar day the same on the server and the client', () => {
    const saved = process.env.TZ;
    process.env.TZ = 'UTC';
    const serverHtml = gridMarkup();
    process.env.TZ = 'America/Los_Angeles';
    const clientHtml = gridMarkup();
    process.env.TZ = saved;
    expect(serverHtml).toContain('Apr 15, 2026');
    expect(clientHtml).toContain('Apr 15, 2026');
    expect(clientHtml).not.toContain('Apr 14');
    expect(serverHtml.match(/Apr \d{1,2}, 2026/g)).toEqual(clientHtml.match(/Apr \d{1,2}, 2026/g));
  });

  it('shows April 15 on a related post', () => {
    const html = renderToStaticMarkup(
      <RelatedPosts
        currentSlug="other"
        currentTags={['Tax Deductions']}
        allPosts={[{
          ...gridPost,
          reviewedAt: null,
          reviewedFor: null,
        }, {
          slug: 'other',
          title: 'Other',
          description: 'Current post',
          date: '2026-05-02',
          author: 'WriteOff Team',
          tags: ['Tax Deductions'],
          readingTime: 2,
          reviewedAt: null,
          reviewedFor: null,
        }]}
      />,
    );
    expect(html).toContain('Apr 15, 2026');
    expect(html).not.toContain('Apr 14, 2026');
  });

  it('flags date only locale formatting without a time zone', () => {
    const { violations, allowed } = unzonedDateFormatting();
    expect(allowed.some(hit => hit.startsWith('components/transaction-detail-screen.tsx:'))).toBe(true);
    expect(violations).toEqual([]);
  });
});
