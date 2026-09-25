import type { MetadataRoute } from "next";
import blogManifest from "@/lib/blog-manifest.json";

export const dynamic = 'force-dynamic';

interface BlogManifestEntry {
  slug: string;
  date: string;
  reviewed: string | null;
}

// The Firebase SSR package ships .next and public only, so content/blog does not
// exist at request time. Posts come from lib/blog-manifest.json (npm run blog:manifest).
const posts = blogManifest as BlogManifestEntry[];

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
    { url: `${baseUrl}/resources/freelance-expense-reset`, lastModified: now, changeFrequency: "monthly", priority: 0.75 },
    { url: `${baseUrl}/contact`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${baseUrl}/help`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${baseUrl}/help-support`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${baseUrl}/about`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${baseUrl}/privacy`, lastModified: now, changeFrequency: "yearly", priority: 0.4 },
    { url: `${baseUrl}/terms`, lastModified: now, changeFrequency: "yearly", priority: 0.4 },
    { url: `${baseUrl}/tools`, lastModified: now, changeFrequency: "weekly", priority: 0.85 },
    { url: `${baseUrl}/tools/se-tax-calculator`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${baseUrl}/tools/1099-tax-calculator`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${baseUrl}/tools/quarterly-estimate-calculator`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
  ];

  const blogPosts: MetadataRoute.Sitemap = posts.map((post) => {
    const parsedDate = new Date(post.reviewed ?? post.date);
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
