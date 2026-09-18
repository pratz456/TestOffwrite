import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { getAllPosts, getPostBySlug } from '../lib/blog';
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

describe('blog front matter', () => {
  it('parses metadata and content through the secure js-yaml path', async () => {
    const posts = getAllPosts();
    const metadata = posts.find(
      (post) => post.slug === 'sales-tax-freelancers-digital-services',
    );

    expect(metadata).toMatchObject({
      title: 'Sales Tax for Freelancers: Do You Actually Have to Collect It?',
      date: '2026-06-05',
      author: 'WriteOff Team',
    });
    expect(metadata?.tags).toContain('Sales Tax');

    const post = await getPostBySlug(
      'sales-tax-freelancers-digital-services',
    );
    expect(post?.contentHtml).toContain(
      'First Question: Are Your Services Even Taxable?',
    );
  });
});
