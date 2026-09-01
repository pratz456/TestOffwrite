import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { getWelcomeView } from '../lib/welcome-view-state';

describe('getWelcomeView', () => {
  it('shows HomeContent when there is no user, including while auth is loading', () => {
    expect(getWelcomeView(null)).toBe('home');
    expect(getWelcomeView(undefined)).toBe('home');
  });

  it('redirects into the product when a user session exists', () => {
    expect(getWelcomeView({ id: 'user-1' })).toBe('redirecting');
  });
});

describe('/login alias', () => {
  it('redirects /login to /auth/login in next.config', () => {
    const src = readFileSync(resolve('next.config.ts'), 'utf8');
    expect(src).toMatch(/source:\s*["']\/login["']/);
    expect(src).toMatch(/destination:\s*["']\/auth\/login["']/);
  });

  it('has an app route that redirects /login to /auth/login', () => {
    const src = readFileSync(resolve('app/login/page.tsx'), 'utf8');
    expect(src).toMatch(/redirect\(\s*["']\/auth\/login["']\s*\)/);
  });
});

describe('marketing homepage claims', () => {
  const landingFiles = [
    'app/page.tsx',
    'components/landing/landing-page.tsx',
    'components/landing/hero-section.tsx',
    'components/landing/landing-header.tsx',
    'components/landing/landing-footer.tsx',
    'components/landing/features-section.tsx',
    'components/landing/problem-section.tsx',
    'components/landing/comparison-section.tsx',
    'components/landing/how-it-works-section.tsx',
    'components/landing/cta-button.tsx',
  ];

  it('does not include unsourced hero proof or named testimonials', () => {
    const combined = landingFiles
      .map((file) => readFileSync(resolve(file), 'utf8'))
      .join('\n');

    expect(combined).not.toMatch(/\$2,847/);
    expect(combined).not.toMatch(/saved today/i);
    expect(combined).not.toMatch(/4\.9\s*\/\s*5/);
    expect(combined).not.toMatch(/4\.9 out of 5/i);
    expect(combined).not.toMatch(/200\+\s*users/i);
    expect(combined).not.toMatch(/Jordan Ellis/);
    expect(combined).not.toMatch(/Lila Freeman/);
    expect(combined).not.toMatch(/Carlos Mendoza/);
    expect(combined).not.toMatch(/Ashley Kim/);
  });

  it('keeps schema price copy that is not a user-count claim', () => {
    const homepage = readFileSync(resolve('app/page.tsx'), 'utf8');
    expect(homepage).toMatch(/price:\s*"14\.99"/);
  });
});
