import React from 'react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NoticeAtCollection } from '@/components/onboarding/consent-checkboxes';
import { PLACEHOLDER_BANK_COLLECTION } from '@/lib/onboarding/bank-consent-copy';

const root = path.resolve(__dirname, '..');

/** Kept product wording, and only the clauses that the new consent flow makes inaccurate. */
const SURFACES: Array<{ file: string; kept: string[]; removed: string[] }> = [
  {
    file: 'app/layout.tsx',
    kept: ['Organize business expenses, review receipts, and export records for your tax preparer.'],
    removed: ['Start with manual entry, with no bank connection required.'],
  },
  {
    file: 'app/page.tsx',
    kept: ['Organize business expenses, review receipts, and export records for your tax preparer.'],
    removed: ['Start with manual entry, with no bank connection required.'],
  },
  {
    file: 'components/landing/restored/hero-section.tsx',
    kept: ['Save expenses and receipts, review their business purpose, and prepare records for your accountant.'],
    removed: ['no bank connection required'],
  },
  {
    file: 'lib/content/faq.ts',
    kept: [
      'you can link accounts through Plaid and WriteOff imports posted transactions for your review.',
      'Bank tokens are encrypted and never shown in the app.',
      'You can always enter income and expenses manually and upload receipts instead.',
    ],
    removed: ['Where bank connections are enabled'],
  },
  {
    file: 'components/blog/blog-cta.tsx',
    kept: ['Enter expenses, upload receipts, and review the details in WriteOff.', 'Try free for 30 days'],
    removed: ['with no bank connection required'],
  },
  {
    file: 'app/opengraph-image.tsx',
    kept: ['Save expenses, review receipt details, and export records for your accountant.'],
    removed: ['Start manually, with no bank connection required'],
  },
  {
    file: 'components/home-content.tsx',
    kept: ['You can start without linking a bank.', 'In-app filing is not available.'],
    removed: [],
  },
  {
    file: 'components/landing/restored/comparison-section.tsx',
    kept: ['AI suggests categories and explains what to review.', 'Bank connections are optional.', 'In-app tax filing is not available.'],
    removed: [],
  },
  {
    file: 'components/data-source-screen.tsx',
    kept: [
      'Add income and expenses manually without connecting a bank',
      'Optional: request transaction sync from a supported bank, then review the imported records.',
    ],
    removed: [],
  },
];

describe('bank collection copy', () => {
  it('keeps the product wording and drops only the clauses the consent flow makes inaccurate', () => {
    for (const surface of SURFACES) {
      const source = readFileSync(path.join(root, surface.file), 'utf8');
      for (const text of surface.kept) expect(source, surface.file).toContain(text);
      for (const text of surface.removed) expect(source, `${surface.file} still says ${text}`).not.toContain(text);
      if (surface.removed.length > 0) expect(source, surface.file).toContain('[PLACEHOLDER]');
    }
    const notice = renderToStaticMarkup(<NoticeAtCollection />);
    expect(notice).toContain('Notice at Collection');
    expect(notice).toContain(PLACEHOLDER_BANK_COLLECTION);
    expect(notice).toContain('Name, email, and password');
    expect(notice).toContain('Employer/workstyle answers');
    expect(notice).toContain('state');
    expect(notice).not.toContain('after signup, your bank transactions');
  });
});
