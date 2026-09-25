import fs from 'fs';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAllPosts } from '@/lib/blog';
import blogManifest from '@/lib/blog-manifest.json';

const root = path.resolve(__dirname, '..');

function isoDate(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return null;
}

describe('blog manifest', () => {
  it('matches the posts in content/blog (run `npm run blog:manifest` after adding or editing a post)', () => {
    const fromContent = getAllPosts()
      .map((post) => ({ slug: post.slug, date: isoDate(post.date), reviewed: post.reviewedAt }))
      .sort((a, b) => a.slug.localeCompare(b.slug));
    expect(blogManifest).toEqual(fromContent);
  });
});

describe('sitemap', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('lists every blog post without reading content/ at request time', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://writeoffapp.com');
    const { default: sitemap } = await import('@/app/sitemap');
    const readdir = vi.spyOn(fs, 'readdirSync');
    const exists = vi.spyOn(fs, 'existsSync');

    const urls = sitemap().map((entry) => entry.url);

    expect(readdir).not.toHaveBeenCalled();
    expect(exists).not.toHaveBeenCalled();
    expect(urls).toContain('https://writeoffapp.com/tools/se-tax-calculator');
    for (const post of blogManifest) expect(urls).toContain(`https://writeoffapp.com/blog/${post.slug}`);
  });

  it('uses the editorial review date as lastModified when present', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://writeoffapp.com');
    const { default: sitemap } = await import('@/app/sitemap');
    const reviewed = blogManifest.find((post) => post.reviewed);
    expect(reviewed).toBeDefined();
    const entry = sitemap().find((item) => item.url.endsWith(`/blog/${reviewed!.slug}`));
    expect(new Date(entry!.lastModified!).toISOString().slice(0, 10)).toBe(reviewed!.reviewed);
  });
});

describe('robots.txt', () => {
  it('is a static Hosting file, because Cloud Functions intercepts /robots.txt before Next', () => {
    expect(fs.existsSync(path.join(root, 'app', 'robots.ts'))).toBe(false);
    const robots = fs.readFileSync(path.join(root, 'public', 'robots.txt'), 'utf8');
    expect(robots).toMatch(/^User-agent: \*$/m);
    expect(robots).toMatch(/^Allow: \/$/m);
    expect(robots).toMatch(/^Disallow: \/protected\/$/m);
    expect(robots).toMatch(/^Disallow: \/api\/$/m);
    expect(robots).toMatch(/^Sitemap: https:\/\/writeoffapp\.com\/sitemap\.xml$/m);
  });

  it('is replaced with a disallow-all file for the staging site', () => {
    const hook = fs.readFileSync(path.join(root, 'scripts', 'staging-hosting-metadata.mjs'), 'utf8');
    expect(hook).toContain("'User-agent: *\\nDisallow: /\\n'");
    const staging = JSON.parse(fs.readFileSync(path.join(root, 'firebase.staging.json'), 'utf8'));
    expect(staging.hosting.predeploy).toContain('node scripts/staging-hosting-metadata.mjs --config firebase.staging.json');
  });
});
