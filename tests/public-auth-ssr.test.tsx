import React from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/firebase/auth-context', () => ({
  useAuth: () => ({ user: null, loading: true, error: null, signOut: async () => {} }),
}));

import { BlogCTA } from '@/components/blog/blog-cta';
import { CtaButton } from '@/components/landing/cta-button';
import { AuthButtons } from '@/components/landing/restored/cta-button';
import { PUBLIC_LOGIN_LINK_LABEL } from '@/lib/public-auth-links';

function anchors(html: string, href: string): string[] {
  return [...html.matchAll(/<a\b[^>]*>/g)].map((match) => match[0]).filter((tag) => tag.includes(`href="${href}"`));
}

function disabledAttribute(tag: string): boolean {
  return /(?:\s|^)disabled(?:\s|=|>|$)/.test(tag);
}

describe('pre-hydration auth links', () => {
  it('keeps the login label in the pending-copy constants file', () => {
    const source = readFileSync('lib/public-auth-links.ts', 'utf8');
    expect(source).toContain('Copy pending approval');
    expect(source).toContain(PUBLIC_LOGIN_LINK_LABEL);
  });

  it('renders homepage, blog header, and blog post calls to action as real sign-up and login anchors', () => {
    const pages = [
      { name: 'homepage', html: renderToStaticMarkup(<AuthButtons />), label: 'Login / Register' },
      { name: 'blog header', html: renderToStaticMarkup(<CtaButton label="Get started" />), label: 'Get started' },
      { name: 'blog post', html: renderToStaticMarkup(<BlogCTA variant="full" />), label: 'Start Your Free Trial' },
    ];

    for (const page of pages) {
      const signUp = anchors(page.html, '/auth/sign-up');
      const login = anchors(page.html, '/auth/login');
      expect(signUp.length, page.name).toBeGreaterThan(0);
      expect(login.length, page.name).toBeGreaterThan(0);
      expect(signUp.some(disabledAttribute), page.name).toBe(false);
      expect(login.some(disabledAttribute), page.name).toBe(false);
      expect(page.html, page.name).toContain(`>${page.label}<`);
      expect(page.html, page.name).toContain(`>${PUBLIC_LOGIN_LINK_LABEL}<`);
      expect(page.html, page.name).not.toContain('<button');
    }
  });
});
