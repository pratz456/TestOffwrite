import type { MetadataRoute } from "next";
import { getAllPosts } from "@/lib/blog";
import { buildPublicSitemap } from "@/lib/public-sitemap";

// Build the URL list while content/blog is on disk. Firebase's server bundle
// does not include that directory for a request-time read, which dropped every
// post from the live sitemap. outputFileTracingIncludes still ships the files
// if this route is executed again on the server.
export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  return buildPublicSitemap(getAllPosts(), baseUrl);
}
