/** Temporary blog content hotfix. Notice and stub wording are pending owner approval. */

export const REDIRECTED_BLOG_SLUGS: Record<string, string> = {
  "qbi-deduction-freelancers-section-199a": "/tools/1099-tax-calculator",
  "tax-deductions-content-creators-influencers": "/tools/1099-tax-calculator",
  "gig-economy-tax-guide": "/tools/1099-tax-calculator",
  "multiple-income-streams-tax-strategy": "/tools/1099-tax-calculator",
  "freelancer-tax-mistakes-cost-money": "/tools/1099-tax-calculator",
};

export const STUBBED_BLOG_SLUGS = [
  "mileage-deduction-guide-2026",
  "retirement-accounts-self-employed",
  "year-end-tax-planning-freelancers",
  "how-to-track-business-expenses",
  "net-operating-loss-freelancers",
  "home-office-deduction-guide",
  "depreciation-recapture-selling-business-assets",
  "reasonable-salary-s-corp-irs",
  "complete-guide-schedule-c-freelancers",
  "top-tax-deductions-freelancers-2026",
] as const;

export const NOINDEX_BLOG_SLUGS = [
  "irs-audit-guide-freelancers",
  "quarterly-estimated-tax-penalty-avoid",
  "hire-your-kids-tax-strategy",
  "1099-forms-explained",
  "quarterly-estimated-taxes-guide",
  "self-employed-health-insurance-deduction-complete",
  "section-179-equipment-deduction-guide",
  "standard-deduction-vs-itemizing-freelancers",
] as const;

/** Pending owner approval. The last phrase links to the calculator. */
export const BLOG_STUB_LINE =
  "This article is being updated. In the meantime, try our free 1099 tax calculator.";

export const BLOG_STUB_LINK_PHRASE = "free 1099 tax calculator";

export const BLOG_STUB_HREF = "/tools/1099-tax-calculator";

/** Pending owner approval. */
export const BLOG_RECHECK_NOTICE =
  "We're re-checking this article against current IRS rules.";

export function isStubbedBlogSlug(slug: string): boolean {
  return (STUBBED_BLOG_SLUGS as readonly string[]).includes(slug);
}

export function isNoindexBlogSlug(slug: string): boolean {
  return (NOINDEX_BLOG_SLUGS as readonly string[]).includes(slug);
}

export function isUnlistedBlogSlug(slug: string): boolean {
  return Object.prototype.hasOwnProperty.call(REDIRECTED_BLOG_SLUGS, slug) || isStubbedBlogSlug(slug);
}

export function blogHotfixRedirects(): { source: string; destination: string; permanent: false }[] {
  return Object.entries(REDIRECTED_BLOG_SLUGS).map(([slug, destination]) => ({
    source: `/blog/${slug}`,
    destination,
    permanent: false,
  }));
}
