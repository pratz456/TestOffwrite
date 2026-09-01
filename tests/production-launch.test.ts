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

describe('/welcome server page', () => {
  it('is a server page that always renders HomeContent', () => {
    const src = readFileSync(resolve('app/welcome/page.tsx'), 'utf8');
    expect(src).not.toMatch(/["']use client["']/);
    expect(src).toMatch(/<HomeContent\s*\/>/);
    expect(src).not.toMatch(/Loading\.\.\./);
  });
});

describe('/login alias', () => {
  it('redirects /login to /auth/login in next.config', () => {
    const src = readFileSync(resolve('next.config.ts'), 'utf8');
    expect(src).toMatch(/source:\s*["']\/login["']/);
    expect(src).toMatch(/destination:\s*["']\/auth\/login["']/);
  });

  it('has an app route that redirects /login to /auth/login and keeps the query string', () => {
    const src = readFileSync(resolve('app/login/page.tsx'), 'utf8');
    expect(src).toMatch(/\/auth\/login/);
    expect(src).toMatch(/searchParams/);
    expect(src).toMatch(/redirect\(/);
  });
});
