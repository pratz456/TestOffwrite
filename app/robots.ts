import type { MetadataRoute } from "next";
import { DISALLOWED_CRAWL_PATHS, publicSiteUrl } from "@/lib/seo/crawl-policy";

// Serve metadata through SSR: Firebase's framework adapter does not publish
// Next 15's prerendered .body metadata files as static Hosting assets.
export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  if (process.env.NEXT_PUBLIC_APP_ENV === "staging") {
    return { rules: [{ userAgent: "*", disallow: "/" }] };
  }

  return {
    rules: [{ userAgent: "*", allow: "/", disallow: [...DISALLOWED_CRAWL_PATHS] }],
    sitemap: `${publicSiteUrl()}/sitemap.xml`,
  };
}
