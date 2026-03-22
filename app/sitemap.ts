import type { MetadataRoute } from "next";
import { getAllPosts } from "@/lib/blog";

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl =
    process.env.NEXT_PUBLIC_SITE_URL ||
    "http://localhost:3000";
  const now = new Date();

  // Keep sitemap focused on indexable marketing/content URLs for better crawl efficiency.
  const staticPages: MetadataRoute.Sitemap = [
    { url: baseUrl, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${baseUrl}/welcome`, lastModified: now, changeFrequency: "weekly", priority: 0.9 },
    { url: `${baseUrl}/blog`, lastModified: now, changeFrequency: "weekly", priority: 0.9 },
    { url: `${baseUrl}/contact`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${baseUrl}/help`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${baseUrl}/help-support`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${baseUrl}/about`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${baseUrl}/privacy`, lastModified: now, changeFrequency: "yearly", priority: 0.4 },
    { url: `${baseUrl}/tools/se-tax-calculator`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
  ];

  const blogPosts: MetadataRoute.Sitemap = getAllPosts().map((post) => {
    const parsedDate = post.date ? new Date(post.date) : now;
    const lastModified = Number.isNaN(parsedDate.getTime()) ? now : parsedDate;
    return {
      url: `${baseUrl}/blog/${post.slug}`,
      lastModified,
      changeFrequency: "monthly",
      priority: 0.75,
    };
  });

  return [...staticPages, ...blogPosts];
}
