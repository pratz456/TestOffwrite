import React from 'react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NoticeAtCollection } from '@/components/onboarding/consent-checkboxes';
import { PLACEHOLDER_BANK_COLLECTION } from '@/lib/onboarding/bank-consent-copy';

const root = path.resolve(__dirname, '..');

/** Surfaces that used to say a bank connection or bank transactions were part of sign up. */
const SURFACES = [
  'app/layout.tsx',
  'app/page.tsx',
  'components/landing/restored/hero-section.tsx',
  'lib/content/faq.ts',
  'components/blog/blog-cta.tsx',
  'app/opengraph-image.tsx',
  'components/home-content.tsx',
  'components/landing/restored/comparison-section.tsx',
  'components/onboarding/consent-checkboxes.tsx',
  'components/data-source-screen.tsx',
];

const OLD_CLAIMS = [
  'after signup, your bank transactions',
  'no bank connection required',
  'without connecting a bank',
  'without linking a bank',
  'Bank connections are optional',
  'Where bank connections are enabled',
  'Start manually, with no bank connection required',
  'request transaction sync from a supported bank',
  'You can start without linking a bank',
  'Start with manual entry',
];

describe('bank collection copy', () => {
  it('uses placeholder copy and does not say bank transactions are collected at sign up', () => {
    for (const surface of SURFACES) {
      const source = readFileSync(path.join(root, surface), 'utf8');
      expect(source, surface).toContain('PLACEHOLDER_BANK_COLLECTION');
      expect(source, surface).not.toMatch(/after sign-?up[^.\n]{0,80}bank/i);
      for (const claim of OLD_CLAIMS) expect(source, `${surface} still says ${claim}`).not.toContain(claim);
    }
    const notice = renderToStaticMarkup(<NoticeAtCollection />);
    expect(notice).toContain('Notice at Collection');
    expect(notice).toContain(PLACEHOLDER_BANK_COLLECTION);
    expect(notice).not.toContain('after signup');
  });
});
