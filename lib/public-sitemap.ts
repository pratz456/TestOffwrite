import type { MetadataRoute } from "next";
import { blogLastModified, type BlogPostMeta } from "@/lib/blog";
import { NOINDEX_BLOG_SLUGS, REDIRECTED_BLOG_SLUGS, STUBBED_BLOG_SLUGS } from "@/lib/blog-hotfix";

/**
 * Blog slugs left out of the sitemap.
 * Includes every slug the blog hotfix noindexes (the noindex list and the stubbed
 * posts, which are also noindex) or redirects, plus posts excluded until tax
 * corrections land.
 */
export const SITEMAP_EXCLUDED_BLOG_SLUGS: readonly string[] = [
  ...Object.keys(REDIRECTED_BLOG_SLUGS),
  ...NOINDEX_BLOG_SLUGS,
  ...STUBBED_BLOG_SLUGS,
  "home-office-deduction-guide",
  "1099-forms-explained",
  "depreciation-recapture-selling-business-assets",
  // excluded until tax corrections land
  "w2-and-1099-side-hustle-taxes",
  "retirement-accounts-self-employed",
  "qbi-deduction-freelancers-section-199a",
  "reasonable-salary-s-corp-irs",
  "self-employment-tax-explained",
  "gig-economy-tax-guide",
  "cpa-vs-tax-software-self-employed",
  "how-irs-knows-your-income-1099k",
  "home-office-deduction-guide",
  "hobby-vs-business-irs-section-183",
  "cohan-rule-lost-receipts",
  "worker-misclassification-1099-employee",
  "irs-cp2000-notice-guide",
  "mileage-deduction-guide-2026",
  "uber-doordash-instacart-tax-guide",
  "freelancer-tax-mistakes-cost-money",
  "irs-audit-guide-freelancers",
];

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

  const excluded = new Set<string>(SITEMAP_EXCLUDED_BLOG_SLUGS);
  const blogPosts: MetadataRoute.Sitemap = posts.filter((post) => post.indexable && post.slug && !excluded.has(post.slug)).map((post) => {
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
