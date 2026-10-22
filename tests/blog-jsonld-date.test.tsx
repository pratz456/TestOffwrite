import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

// The blog page relies on the automatic JSX runtime. This runner emits
// React.createElement, so the page render looks up the global.
globalThis.React = React;

const updatedOverride = vi.hoisted(() => ({ slug: '', updatedAt: null as string | null }));

vi.mock('@/components/blog/blog-cta', () => ({ BlogCTA: () => null }));
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('notFound'); } }));
vi.mock('@/lib/blog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/blog')>();
  return {
    ...actual,
    async getPostBySlug(slug: string) {
      const post = await actual.getPostBySlug(slug);
      if (post && updatedOverride.slug === slug && updatedOverride.updatedAt) {
        return { ...post, updatedAt: updatedOverride.updatedAt };
      }
      return post;
    },
  };
});

import BlogPostPage from '@/app/blog/[slug]/page';

function dateModified(html: string): string {
  const match = html.match(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/);
  expect(match, html).toBeTruthy();
  return JSON.parse(match![1]).dateModified;
}

async function renderPost(slug: string) {
  return renderToStaticMarkup(await BlogPostPage({ params: Promise.resolve({ slug }) }));
}

describe('blog article dateModified', () => {
  beforeEach(() => {
    updatedOverride.slug = '';
    updatedOverride.updatedAt = null;
  });

  it('keeps hobby-vs-business on the reviewed date when updated is absent', async () => {
    const html = await renderPost('hobby-vs-business-irs-section-183');
    expect(dateModified(html)).toBe('2026-09-17');
    expect(html).toContain('Reviewed September 2026');
  });

  it('uses updated as dateModified when that front-matter value is set', async () => {
    updatedOverride.slug = 'hobby-vs-business-irs-section-183';
    updatedOverride.updatedAt = '2026-10-01';
    const html = await renderPost(updatedOverride.slug);
    expect(dateModified(html)).toBe('2026-10-01');
    expect(html).toContain('Reviewed September 2026');
  });
});
