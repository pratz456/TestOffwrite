import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import yaml from 'js-yaml';
import sitemap from '../app/sitemap';
import robots from '../app/robots';
import { blogPostLastModified, getAllPosts, isWithheldBlogFrontMatter, UNPUBLISHED_BLOG_SLUGS } from '../lib/blog';
import { CANONICAL_SITE_URL, DISALLOWED_CRAWL_PATHS } from '../lib/seo/crawl-policy';

const BLOG_DIR = path.join(process.cwd(), 'content', 'blog');
const FROZEN_TODAY = '2026-10-22';

function blogFiles(): string[] {
  return fs.readdirSync(BLOG_DIR).filter((file) => file.endsWith('.mdx')).sort();
}

// Same YAML engine as lib/blog.ts. gray-matter's default still calls js-yaml 3's safeLoad.
const matterOptions = {
  engines: {
    yaml: {
      parse: (source: string) => yaml.load(source) as Record<string, unknown>,
      stringify: (value: Record<string, unknown>) => yaml.dump(value),
    },
  },
};

function frontMatter(file: string): Record<string, unknown> {
  return matter(fs.readFileSync(path.join(BLOG_DIR, file), 'utf8'), matterOptions).data as Record<string, unknown>;
}

function lastmodDay(value: string | Date | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function freezeClock() {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(`${FROZEN_TODAY}T12:00:00.000Z`));
  expect(new Date().toISOString().slice(0, 10)).toBe(FROZEN_TODAY);
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('public sitemap', () => {
  it('lists every content/blog file exactly once', () => {
    freezeClock();
    const files = blogFiles();
    const urls = sitemap().map((entry) => entry.url);
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const slug = file.replace(/\.mdx$/, '');
      const url = `${CANONICAL_SITE_URL}/blog/${slug}`;
      const appearances = urls.filter((candidate) => candidate === url).length;
      const withheld = UNPUBLISHED_BLOG_SLUGS.has(slug) || isWithheldBlogFrontMatter(frontMatter(file));
      expect(appearances, file).toBe(withheld ? 0 : 1);
    }

    const publishedSlugs = new Set(getAllPosts().map((post) => post.slug));
    expect(publishedSlugs.size).toBe(files.filter((file) => {
      const slug = file.replace(/\.mdx$/, '');
      return !UNPUBLISHED_BLOG_SLUGS.has(slug) && !isWithheldBlogFrontMatter(frontMatter(file));
    }).length);
  });

  it('sets hobby-vs-business lastmod from its front matter, not the clock', () => {
    freezeClock();
    const data = frontMatter('hobby-vs-business-irs-section-183.mdx');
    const post = getAllPosts().find((item) => item.slug === 'hobby-vs-business-irs-section-183');
    expect(post?.updatedAt ?? null).toBeNull();
    expect(typeof data.reviewed).toBe('string');
    expect(post?.reviewedAt).toBe(data.reviewed);
    expect(blogPostLastModified(post!)).toBe(data.reviewed);

    const entry = sitemap().find((item) => item.url === `${CANONICAL_SITE_URL}/blog/hobby-vs-business-irs-section-183`);
    expect(lastmodDay(entry?.lastModified)).toBe(data.reviewed);
    expect(lastmodDay(entry?.lastModified)).not.toBe(FROZEN_TODAY);
  });

  it('does not use today as lastmod unless front matter says so', () => {
    freezeClock();
    for (const entry of sitemap()) {
      const day = lastmodDay(entry.lastModified);
      if (day !== FROZEN_TODAY) continue;
      const slug = entry.url.slice(`${CANONICAL_SITE_URL}/blog/`.length);
      const data = frontMatter(`${slug}.mdx`);
      const stated = [data.updated, data.reviewed, data.date].map((value) => (
        value instanceof Date ? value.toISOString().slice(0, 10) : String(value ?? '')
      ));
      expect(stated, entry.url).toContain(FROZEN_TODAY);
    }
  });

  it('keeps absolute https://writeoffapp.com URLs with no duplicates', () => {
    freezeClock();
    const entries = sitemap();
    const urls = entries.map((entry) => entry.url);
    expect(new Set(urls).size).toBe(urls.length);
    for (const url of urls) {
      expect(url.startsWith(`${CANONICAL_SITE_URL}/`) || url === CANONICAL_SITE_URL).toBe(true);
      expect(url.includes('localhost')).toBe(false);
      expect(url.includes('http://')).toBe(false);
    }
    for (const page of ['', '/welcome', '/blog', '/resources/freelance-expense-reset', '/contact', '/help', '/about', '/privacy', '/terms', '/tools', '/tools/se-tax-calculator', '/tools/1099-tax-calculator', '/tools/quarterly-estimate-calculator']) {
      expect(urls).toContain(`${CANONICAL_SITE_URL}${page}`);
    }
    for (const entry of entries) {
      const pathName = entry.url.slice(CANONICAL_SITE_URL.length);
      const isPost = pathName.startsWith('/blog/') && pathName.length > '/blog/'.length;
      if (!isPost) expect(entry.lastModified, entry.url).toBeUndefined();
    }
  });

  it('prefers updated, then reviewed, then date', () => {
    expect(blogPostLastModified({ updatedAt: '2026-10-01', reviewedAt: '2026-09-17', date: '2026-05-06' })).toBe('2026-10-01');
    expect(blogPostLastModified({ updatedAt: null, reviewedAt: '2026-09-17', date: '2026-05-06' })).toBe('2026-09-17');
    expect(blogPostLastModified({ updatedAt: null, reviewedAt: null, date: '2026-05-06' })).toBe('2026-05-06');
    expect(blogPostLastModified({ updatedAt: null, reviewedAt: null, date: '' })).toBeNull();
  });

  it('does not call the clock from the crawl metadata sources', () => {
    for (const file of ['app/sitemap.ts', 'app/robots.ts', 'lib/seo/crawl-policy.ts']) {
      expect(fs.readFileSync(file, 'utf8'), file).not.toMatch(/new Date\(\s*\)/);
    }
  });
});

describe('robots.txt', () => {
  it('disallows /api/ and includes the Sitemap line', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'http://localhost:3000');
    const result = robots();
    const rule = Array.isArray(result.rules) ? result.rules[0] : result.rules;
    const disallow = [rule.disallow].flat().filter((value): value is string => typeof value === 'string');
    expect(rule.userAgent).toBe('*');
    expect(rule.allow).toBe('/');
    expect(disallow).toContain('/api/');
    expect(disallow).toEqual([...DISALLOWED_CRAWL_PATHS]);
    expect(result.sitemap).toBe(`${CANONICAL_SITE_URL}/sitemap.xml`);
    expect(`Sitemap: ${result.sitemap}`).toBe('Sitemap: https://writeoffapp.com/sitemap.xml');
  });

  it('keeps the staging host disallowed', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_ENV', 'staging');
    const result = robots();
    const rule = Array.isArray(result.rules) ? result.rules[0] : result.rules;
    expect(rule.disallow).toBe('/');
    expect(result.sitemap).toBeUndefined();
  });
});
