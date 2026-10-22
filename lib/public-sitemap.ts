import type { MetadataRoute } from "next";
import { blogLastModified, type BlogPostMeta } from "@/lib/blog";

const STATIC_PAGES: Array<{ path: string; changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"]; priority: number }> = [
  { path: "", changeFrequency: "weekly", priority: 1 },
  { path: "/blog", changeFrequency: "weekly", priority: 0.9 },
  { path: "/resources/freelance-expense-reset", changeFrequency: "monthly", priority: 0.75 },
  { path: "/contact", changeFrequency: "monthly", priority: 0.7 },
  { path: "/help", changeFrequency: "monthly", priority: 0.7 },
  { path: "/help-support", changeFrequency: "monthly", priority: 0.6 },
  { path: "/about", changeFrequency: "monthly", priority: 0.6 },
  { path: "/privacy", changeFrequency: "yearly", priority: 0.4 },
  { path: "/terms", changeFrequency: "yearly", priority: 0.4 },
  { path: "/tools", changeFrequency: "weekly", priority: 0.85 },
  { path: "/tools/se-tax-calculator", changeFrequency: "monthly", priority: 0.8 },
  { path: "/tools/1099-tax-calculator", changeFrequency: "monthly", priority: 0.8 },
  { path: "/tools/quarterly-estimate-calculator", changeFrequency: "monthly", priority: 0.8 },
];

export function buildPublicSitemap(posts: BlogPostMeta[], baseUrl: string, staticLastModified: Date = new Date()): MetadataRoute.Sitemap {
  const origin = baseUrl.replace(/\/$/, "");
  const staticPages: MetadataRoute.Sitemap = STATIC_PAGES.map((page) => ({
    url: `${origin}${page.path}`,
    lastModified: staticLastModified,
    changeFrequency: page.changeFrequency,
    priority: page.priority,
  }));

  const blogPosts: MetadataRoute.Sitemap = posts.filter((post) => post.indexable && post.slug).map((post) => {
    const lastModified = blogLastModified(post.date);
    return {
      url: `${origin}/blog/${post.slug}`,
      ...(lastModified ? { lastModified } : {}),
      changeFrequency: "monthly" as const,
      priority: 0.75,
    };
  });

  return [...staticPages, ...blogPosts];
}
