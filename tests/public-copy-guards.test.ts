import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { faqData } from '../lib/content/faq';

const PRICE_FAQ = 'How much does WriteOff cost?';
const REMOVED_CLAUSE = 'existing Basic subscribers keep their $7.99 monthly price and extended history';

function filesUnder(dir: string, skip = new Set<string>()): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    if (skip.has(name)) continue;
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) found.push(...filesUnder(path));
    else if (/\.(tsx?|mdx|json)$/.test(name)) found.push(path);
  }
  return found;
}

describe('public pricing and bank-connection copy', () => {
  it('drops the legacy Basic price from the help FAQ and its JSON-LD', () => {
    const answer = faqData.find((item) => item.question === PRICE_FAQ)?.answer ?? '';
    expect(answer).toBe(
      'The Free plan keeps basic records and the records archive accessible. The 30-day trial and Premium plans unlock reports and exports. Listed Premium pricing is $14.99 monthly or $149.99 yearly. In-app tax filing is not offered on any plan.',
    );
    expect(answer).not.toContain(REMOVED_CLAUSE);
    expect(answer).not.toContain('$7.99');
    const jsonLd = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: faqData.map((item) => ({
        '@type': 'Question',
        name: item.question,
        acceptedAnswer: { '@type': 'Answer', text: item.answer },
      })),
    });
    expect(jsonLd).not.toContain('$7.99');
    expect(jsonLd).not.toContain(REMOVED_CLAUSE);
  });

  it('leaves no $7.99 string on public pages or JSON-LD sources', () => {
    const paths = [
      ...filesUnder('app', new Set(['protected', 'api'])),
      ...filesUnder('components/landing'),
      ...filesUnder('components/blog'),
      ...filesUnder('lib/content'),
      ...filesUnder('content/blog'),
      'components/home-content.tsx',
      'components/faq-section.tsx',
    ];
    const hits = paths.filter((path) => readFileSync(path, 'utf8').includes('$7.99'));
    expect(hits.map((path) => relative(process.cwd(), path))).toEqual([]);
  });

  it('keeps the no-bank-connection sentence off the homepage, welcome, and help', () => {
    const surfaces = [
      ...filesUnder('app/help'),
      ...filesUnder('app/help-support'),
      ...filesUnder('components/landing'),
      'app/page.tsx',
      'app/layout.tsx',
      'app/welcome/page.tsx',
      'components/home-content.tsx',
      'components/faq-section.tsx',
      'lib/content/faq.ts',
    ];
    for (const path of surfaces) {
      expect(readFileSync(path, 'utf8').toLowerCase(), path).not.toContain('no bank connection');
    }
    expect(readFileSync('lib/guidance/action-engine.ts', 'utf8')).toContain(
      'no bank connection is required',
    );
  });
});
