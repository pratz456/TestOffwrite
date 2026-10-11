import { describe, expect, it } from 'vitest';
import { getAllPosts, getPostBySlug, UNPUBLISHED_BLOG_SLUGS } from '@/lib/blog';

describe('blog publication policy', () => {
  it('keeps posts with unresolved tax or legal claims out of listings and direct routes', async () => {
    const publicSlugs = new Set(getAllPosts().map(post => post.slug));
    expect(UNPUBLISHED_BLOG_SLUGS.size).toBeGreaterThan(0);
    for (const slug of UNPUBLISHED_BLOG_SLUGS) {
      expect(publicSlugs.has(slug), slug).toBe(false);
      await expect(getPostBySlug(slug)).resolves.toBeNull();
    }
  });
});
