import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Calendar, Clock, ArrowLeft, ChevronLeft, ChevronRight, User } from "lucide-react";
import { getAllPosts, getPostBySlug, getAdjacentPosts } from "@/lib/blog";
import { BlogCTA } from "@/components/blog/blog-cta";

export async function generateStaticParams() {
  return getAllPosts().map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPostBySlug(slug);
  if (!post) return {};

  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://writeoffapp.com";

  return {
    title: post.title,
    description: post.description,
    authors: [{ name: post.author }],
    alternates: { canonical: `/blog/${slug}` },
    openGraph: {
      type: "article",
      title: post.title,
      description: post.description,
      url: `/blog/${slug}`,
      publishedTime: post.date,
      authors: [post.author],
      tags: post.tags,
      siteName: "WriteOff",
      images: [{ url: `${baseUrl}/og-image.png`, width: 1200, height: 630, alt: post.title }],
    },
    twitter: {
      card: "summary_large_image",
      title: post.title,
      description: post.description,
    },
  };
}

function PostContent({ html, hasMidCta }: { html: string; hasMidCta: boolean }) {
  if (!hasMidCta) {
    return (
      <div
        className="prose prose-lg max-w-none"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }

  const parts = html.split("<!--BLOG_CTA-->");
  return (
    <div className="prose prose-lg max-w-none">
      <div dangerouslySetInnerHTML={{ __html: parts[0] }} />
      <BlogCTA variant="inline" />
      {parts[1] && <div dangerouslySetInnerHTML={{ __html: parts[1] }} />}
    </div>
  );
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = await getPostBySlug(slug);
  if (!post) notFound();

  const { prev, next } = getAdjacentPosts(slug);
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://writeoffapp.com";

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    description: post.description,
    datePublished: post.date,
    dateModified: post.date,
    author: { "@type": "Person", name: post.author },
    publisher: {
      "@type": "Organization",
      name: "WriteOff",
      url: baseUrl,
      logo: { "@type": "ImageObject", url: `${baseUrl}/writeofflogo.png` },
    },
    mainEntityOfPage: { "@type": "WebPage", "@id": `${baseUrl}/blog/${slug}` },
    image: `${baseUrl}/og-image.png`,
  };

  return (
    <>
      <script
        type="application/ld+json"
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <article className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
        {/* Back link */}
        <Link
          href="/blog"
          className="mb-6 inline-flex items-center gap-1 text-sm font-medium text-muted-foreground transition-colors hover:text-primary"
        >
          <ArrowLeft className="h-4 w-4" />
          All posts
        </Link>

        {/* Header */}
        <header className="mb-8">
          <div className="mb-3 flex flex-wrap gap-2">
            {post.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary"
              >
                {tag}
              </span>
            ))}
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">
            {post.title}
          </h1>
          <div className="mt-4 flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <User className="h-4 w-4" />
              {post.author}
            </span>
            <span className="flex items-center gap-1.5">
              <Calendar className="h-4 w-4" />
              {new Date(post.date).toLocaleDateString("en-US", {
                month: "long",
                day: "numeric",
                year: "numeric",
              })}
            </span>
            <span className="flex items-center gap-1.5">
              <Clock className="h-4 w-4" />
              {post.readingTime} min read
            </span>
          </div>
        </header>

        {/* Body */}
        <PostContent html={post.contentHtml} hasMidCta={post.hasMidCta} />

        {/* End-of-post CTA */}
        <BlogCTA variant="full" />

        {/* Previous / Next navigation */}
        <nav className="mt-12 grid gap-4 sm:grid-cols-2">
          {prev ? (
            <Link
              href={`/blog/${prev.slug}`}
              className="group flex items-start gap-3 rounded-xl border border-border bg-card p-4 transition-all hover:border-primary/20 hover:shadow-lg hover:shadow-primary/5"
            >
              <ChevronLeft className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground group-hover:text-primary" />
              <div>
                <span className="text-xs font-medium text-muted-foreground">Previous</span>
                <p className="mt-0.5 text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
                  {prev.title}
                </p>
              </div>
            </Link>
          ) : (
            <div />
          )}
          {next ? (
            <Link
              href={`/blog/${next.slug}`}
              className="group flex items-start gap-3 rounded-xl border border-border bg-card p-4 text-right transition-all hover:border-primary/20 hover:shadow-lg hover:shadow-primary/5 sm:flex-row-reverse sm:text-right"
            >
              <ChevronRight className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground group-hover:text-primary" />
              <div>
                <span className="text-xs font-medium text-muted-foreground">Next</span>
                <p className="mt-0.5 text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
                  {next.title}
                </p>
              </div>
            </Link>
          ) : (
            <div />
          )}
        </nav>
      </article>
    </>
  );
}
