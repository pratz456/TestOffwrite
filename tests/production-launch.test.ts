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
