import React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

globalThis.React = React;
vi.mock("next/link", () => ({
  default: (props: { href: string; children?: unknown; className?: string }) =>
    React.createElement("a", { href: props.href, className: props.className }, props.children),
}));
import { getRedirectUrl, unstable_getResponseFromNextConfig } from "next/experimental/testing/server";
import nextConfig from "../next.config";
import { getListedPosts, getPostBySlug } from "@/lib/blog";
import {
  BLOG_RECHECK_NOTICE,
  BLOG_STUB_HREF,
  BLOG_STUB_LINE,
  NOINDEX_BLOG_SLUGS,
  REDIRECTED_BLOG_SLUGS,
  STUBBED_BLOG_SLUGS,
} from "@/lib/blog-hotfix";
import BlogPostPage, { generateMetadata } from "@/app/blog/[slug]/page";
import sitemap from "@/app/sitemap";

const NORMAL_SLUG = "self-employment-tax-explained";
const HIDDEN_ORIGINAL_SENTENCE: Record<string, string> = {
  "complete-guide-schedule-c-freelancers": "WriteOff generates Schedule C-ready reports automatically.",
  "top-tax-deductions-freelancers-2026": "Its AI connects to your bank accounts",
};
const ORIGIN = "https://writeoffapp.com";

function plainSentence(slug: string): string {
  const raw = readFileSync(new URL(`../content/blog/${slug}.mdx`, import.meta.url), "utf8");
  const body = raw.replace(/^---[\s\S]*?---/, "");
  const line = body
    .split("\n")
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 40 && !/[*_`#[\]|]/.test(entry) && /[.!?]$/.test(entry));
  if (!line) throw new Error(`no plain sentence in ${slug}`);
  return line;
}

function pageHtml(node: React.ReactNode): string {
  return renderToStaticMarkup(node as React.ReactElement)
    .replace(/<[^>]+>/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, "\"")
    .replace(/&amp;/g, "&");
}

describe("temporary blog redirects", () => {
  it.each(Object.entries(REDIRECTED_BLOG_SLUGS))(
    "redirects /blog/%s to %s with Next's temporary status",
    async (slug, destination) => {
      const response = await unstable_getResponseFromNextConfig({
        url: `${ORIGIN}/blog/${slug}`,
        nextConfig,
      });
      expect(response.status).toBe(307);
      expect(getRedirectUrl(response)).toBe(`${ORIGIN}${destination}`);
    },
  );

  it("does not redirect a stub, a noindex post, or a normal post", async () => {
    for (const slug of [...STUBBED_BLOG_SLUGS, ...NOINDEX_BLOG_SLUGS, NORMAL_SLUG]) {
      const response = await unstable_getResponseFromNextConfig({
        url: `${ORIGIN}/blog/${slug}`,
        nextConfig,
      });
      expect(response.status).toBe(200);
      expect(getRedirectUrl(response)).toBeNull();
    }
  });
});

describe("temporary blog listings", () => {
  it("omits the redirected and stubbed posts from the index helper", () => {
    const listed = getListedPosts().map((post) => post.slug);
    const unlisted = [...Object.keys(REDIRECTED_BLOG_SLUGS), ...STUBBED_BLOG_SLUGS];
    expect(listed).not.toEqual(expect.arrayContaining(unlisted));
    expect(listed).toEqual(expect.arrayContaining([...NOINDEX_BLOG_SLUGS, NORMAL_SLUG]));
  });

  it("omits every hotfix slug from the sitemap and keeps a normal post", () => {
    const urls = sitemap().map((entry) => entry.url);
    const listedUrl = (slug: string) => urls.some((url) => url.endsWith(`/blog/${slug}`));
    const hotfixSlugs = [
      ...Object.keys(REDIRECTED_BLOG_SLUGS),
      ...STUBBED_BLOG_SLUGS,
      ...NOINDEX_BLOG_SLUGS,
    ];
    for (const slug of hotfixSlugs) expect(listedUrl(slug), slug).toBe(false);
    expect(listedUrl("w9-1099-guide-freelancers")).toBe(true);
  });
});

describe("stubbed blog posts", () => {
  it.each(STUBBED_BLOG_SLUGS)("%s is noindex, shows the stub line, and hides the original article", async (slug) => {
    const sentence = plainSentence(slug);
    const post = await getPostBySlug(slug);
    const metadata = await generateMetadata({ params: Promise.resolve({ slug }) });
    const page = await BlogPostPage({ params: Promise.resolve({ slug }) });
    const html = renderToStaticMarkup(page as React.ReactElement);
    const text = pageHtml(page);

    expect(post?.title).toBeTruthy();
    expect(metadata.title).toBe(post?.title);
    expect(metadata.description).toBe(BLOG_STUB_LINE);
    expect(metadata.openGraph && "description" in metadata.openGraph ? metadata.openGraph.description : undefined).toBe(BLOG_STUB_LINE);
    expect(metadata.twitter?.description).toBe(BLOG_STUB_LINE);
    expect(metadata.description).not.toBe(post?.description);
    expect(metadata.robots).toEqual({ index: false, follow: true });
    expect(text).toContain(post?.title);
    expect(text).toContain(BLOG_STUB_LINE);
    expect(html).toContain(`href="${BLOG_STUB_HREF}"`);
    expect(text).not.toContain(sentence);
    const hidden = HIDDEN_ORIGINAL_SENTENCE[slug];
    if (hidden) expect(text).not.toContain(hidden);
    expect(text).not.toContain(post?.description);
    expect(text).not.toContain('"@type":"Article"');
    expect(text).not.toContain("Keep your expense records together");
    expect(text).not.toContain(BLOG_RECHECK_NOTICE);
  });
});

describe("noindex blog posts and a normal post", () => {
  it.each(NOINDEX_BLOG_SLUGS)("%s is noindex and shows the recheck notice", async (slug) => {
    const sentence = plainSentence(slug);
    const metadata = await generateMetadata({ params: Promise.resolve({ slug }) });
    const text = pageHtml(await BlogPostPage({ params: Promise.resolve({ slug }) }));
    expect(metadata.robots).toEqual({ index: false, follow: true });
    expect(text).toContain(BLOG_RECHECK_NOTICE);
    expect(text).toContain(sentence);
    expect(text).not.toContain(BLOG_STUB_LINE);
  });

  it("leaves a normal published post listed, indexable, and without the notice", async () => {
    const sentence = plainSentence(NORMAL_SLUG);
    const metadata = await generateMetadata({ params: Promise.resolve({ slug: NORMAL_SLUG }) });
    const text = pageHtml(await BlogPostPage({ params: Promise.resolve({ slug: NORMAL_SLUG }) }));
    expect(getListedPosts().map((post) => post.slug)).toContain(NORMAL_SLUG);
    expect(metadata.robots).toBeUndefined();
    expect(metadata.description).not.toBe(BLOG_STUB_LINE);
    expect(text).toContain(sentence);
    expect(text).not.toContain(BLOG_RECHECK_NOTICE);
    expect(text).not.toContain("This article is being updated.");
  });
});
