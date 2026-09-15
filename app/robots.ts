import type { MetadataRoute } from "next";

// Serve metadata through SSR: Firebase's framework adapter does not publish
// Next 15's prerendered .body metadata files as static Hosting assets.
export const dynamic = 'force-dynamic';

export default function robots(): MetadataRoute.Robots {
  if (process.env.NEXT_PUBLIC_APP_ENV === 'staging') {
    return { rules: [{ userAgent: '*', disallow: '/' }] };
  }
  const baseUrl =
    process.env.NEXT_PUBLIC_SITE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/protected/", "/api/"] }],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
