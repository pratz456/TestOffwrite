import type { MetadataRoute } from "next";
import { blogPostLastModified, getAllPosts } from "@/lib/blog";
import { publicSiteUrl } from "@/lib/seo/crawl-policy";

// Serve metadata through SSR: Firebase's framework adapter does not publish
// Next 15's prerendered .body metadata files as static Hosting assets.
export const dynamic = "force-dynamic";

// Public URLs already emitted by this route. Dates stay off these entries:
// none of these pages has a content date, and lastmod must not be the build
// or request clock.
const STATIC_PAGES: Array<{
  path: string;
  changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"];
  priority: number;
}> = [
  { path: "", changeFrequency: "weekly", priority: 1 },
  { path: "/welcome", changeFrequency: "weekly", priority: 0.9 },
  { path: "/blog", changeFrequency: "weekly", priority: 0.9 },
  { path: "/resources/freelance-expense-reset", changeFrequency: "monthly", priority: 0.75 },
  { path: "/contact", changeFrequency: "monthly", priority: 0.7 },
  { path: "/help", changeFrequency: "monthly", priority: 0.7 },
  { path: "/about", changeFrequency: "monthly", priority: 0.6 },
  { path: "/privacy", changeFrequency: "yearly", priority: 0.4 },
  { path: "/terms", changeFrequency: "yearly", priority: 0.4 },
  { path: "/tools", changeFrequency: "weekly", priority: 0.85 },
  { path: "/tools/se-tax-calculator", changeFrequency: "monthly", priority: 0.8 },
  { path: "/tools/1099-tax-calculator", changeFrequency: "monthly", priority: 0.8 },
  { path: "/tools/quarterly-estimate-calculator", changeFrequency: "monthly", priority: 0.8 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = publicSiteUrl();

  const staticPages: MetadataRoute.Sitemap = STATIC_PAGES.map((page) => ({
    url: `${baseUrl}${page.path}`,
    changeFrequency: page.changeFrequency,
    priority: page.priority,
  }));

  const blogPosts: MetadataRoute.Sitemap = getAllPosts().map((post) => {
    const lastModified = blogPostLastModified(post);
    return {
      url: `${baseUrl}/blog/${post.slug}`,
      ...(lastModified ? { lastModified } : {}),
      changeFrequency: "monthly" as const,
      priority: 0.75,
    };
  });

  return [...staticPages, ...blogPosts];
}
