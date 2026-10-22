import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { blogLastModified, blogPostIndexable, getAllPosts } from '../lib/blog';
import { buildPublicSitemap } from '../lib/public-sitemap';
import { publicShareImage } from '../lib/public-share-image';

const baseUrl = 'https://writeoffapp.com';
const staticLastModified = new Date('2030-01-01T00:00:00.000Z');

describe('public sitemap', () => {
  const posts = getAllPosts();
  const entries = buildPublicSitemap(posts, baseUrl, staticLastModified);
  const urls = entries.map((entry) => entry.url);

  it('lists every published blog slug and uses the post date for lastmod', () => {
    const published = posts.filter((post) => post.indexable);
    const files = readdirSync('content/blog').filter((file) => file.endsWith('.mdx'));
    expect(published.map((post) => post.slug).sort()).toEqual(files.map((file) => file.replace(/\.mdx$/, '')).sort());
    for (const post of published) {
      expect(urls).toContain(`${baseUrl}/blog/${post.slug}`);
      const entry = entries.find((item) => item.url === `${baseUrl}/blog/${post.slug}`);
      expect(entry?.lastModified).toBe(blogLastModified(post.date));
      expect(entry?.lastModified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(String(entry?.lastModified)).not.toContain('2030-01-01');
    }
  });

  it('omits /welcome and unpublished or noindex posts', () => {
    expect(urls.some((url) => url.replace(/\/$/, '').endsWith('/welcome'))).toBe(false);
    const hidden = buildPublicSitemap([
      { ...posts[0], slug: 'draft-post', indexable: false, date: '2026-01-01' },
      { ...posts[0], slug: 'visible-post', indexable: true, date: '2026-02-02' },
    ], baseUrl, staticLastModified).map((entry) => entry.url);
    expect(hidden).not.toContain(`${baseUrl}/blog/draft-post`);
    expect(hidden).toContain(`${baseUrl}/blog/visible-post`);
    expect(blogPostIndexable({ published: false })).toBe(false);
    expect(blogPostIndexable({ draft: true })).toBe(false);
    expect(blogPostIndexable({ noindex: true })).toBe(false);
    expect(blogPostIndexable({ status: 'unpublished' })).toBe(false);
    expect(blogPostIndexable({ robots: 'noindex, nofollow' })).toBe(false);
    expect(blogPostIndexable({ robots: { index: false } })).toBe(false);
    expect(blogPostIndexable({ title: 'Published' })).toBe(true);
    expect(blogLastModified('not-a-date')).toBeUndefined();
  });
});

describe('public robots.txt', () => {
  it('is the only robots source and allows the site except private app paths', () => {
    expect(existsSync('app/robots.ts')).toBe(false);
    const robots = readFileSync('public/robots.txt', 'utf8');
    expect(robots).toMatch(/User-Agent: \*/);
    expect(robots).toMatch(/Allow: \/\n/);
    expect(robots).toContain('Disallow: /protected/');
    expect(robots).toContain('Disallow: /api/');
    expect(robots).toContain('Sitemap: https://writeoffapp.com/sitemap.xml');
    expect(robots).not.toMatch(/Disallow: \/\s/);
  });
});

describe('blog and tools share image metadata', () => {
  it('points openGraph and twitter images at the existing share card', () => {
    expect(publicShareImage).toEqual({ url: '/og-image.png', width: 1200, height: 630, alt: 'WriteOff' });
    expect(existsSync('public/og-image.png')).toBe(true);
    for (const file of ['app/blog/page.tsx', 'app/tools/page.tsx']) {
      const source = readFileSync(file, 'utf8');
      expect(source).toMatch(/openGraph:[\s\S]*images:\s*\[publicShareImage\]/);
      expect(source).toMatch(/twitter:[\s\S]*images:\s*\[publicShareImage\.url\]/);
    }
  });
});
