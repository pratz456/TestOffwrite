import type { Metadata } from "next";
import Link from "next/link";
import { Calendar, Clock, Receipt, CalendarDays, FolderCheck, FileText, Sparkles } from "lucide-react";
import { getAllPosts } from "@/lib/blog";
import { ScrollRevealWrapper } from "@/components/blog/scroll-reveal-wrapper";

export const metadata: Metadata = {
  title: "Tax Tips & Guides for Freelancers",
  description:
    "Practical tax deduction tips, expense tracking guides, and IRS filing advice for freelancers, contractors, and self-employed workers.",
  alternates: { canonical: "/blog" },
  openGraph: {
    title: "Tax Tips & Guides for Freelancers | WriteOff",
    description:
      "Practical tax deduction tips, expense tracking guides, and IRS filing advice for freelancers and self-employed workers.",
    type: "website",
    url: "/blog",
  },
  twitter: {
    card: "summary_large_image",
    title: "Tax Tips & Guides for Freelancers | WriteOff",
    description:
      "Practical tax tips and expense tracking guides for freelancers.",
  },
};

const TAG_STYLES: Record<string, { gradient: string; iconColor: string; pillBg: string; pillText: string }> = {
  "Tax Deductions": {
    gradient: "from-blue-500 via-blue-400 to-cyan-400",
    iconColor: "text-white/30",
    pillBg: "bg-blue-100",
    pillText: "text-blue-700",
  },
  "Quarterly Taxes": {
    gradient: "from-emerald-500 via-emerald-400 to-teal-400",
    iconColor: "text-white/30",
    pillBg: "bg-emerald-100",
    pillText: "text-emerald-700",
  },
  "Expense Tracking": {
    gradient: "from-violet-500 via-violet-400 to-blue-400",
    iconColor: "text-white/30",
    pillBg: "bg-violet-100",
    pillText: "text-violet-700",
  },
  "Schedule C": {
    gradient: "from-amber-500 via-amber-400 to-orange-400",
    iconColor: "text-white/30",
    pillBg: "bg-amber-100",
    pillText: "text-amber-700",
  },
};

const TAG_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  "Tax Deductions": Receipt,
  "Quarterly Taxes": CalendarDays,
  "Expense Tracking": FolderCheck,
  "Schedule C": FileText,
};

function getTagStyle(tags: string[]) {
  for (const tag of tags) {
    if (TAG_STYLES[tag]) return { style: TAG_STYLES[tag], tag, Icon: TAG_ICONS[tag] };
  }
  return {
    style: TAG_STYLES["Tax Deductions"],
    tag: tags[0] ?? "Guide",
    Icon: Receipt,
  };
}

export default function BlogIndexPage() {
  const posts = getAllPosts();

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Blog",
    name: "WriteOff Blog",
    description: "Tax tips, expense tracking guides, and IRS filing advice for freelancers.",
    url: `${process.env.NEXT_PUBLIC_SITE_URL || "https://writeoffapp.com"}/blog`,
    publisher: {
      "@type": "Organization",
      name: "WriteOff",
      url: process.env.NEXT_PUBLIC_SITE_URL || "https://writeoffapp.com",
    },
    blogPost: posts.map((p) => ({
      "@type": "BlogPosting",
      headline: p.title,
      description: p.description,
      datePublished: p.date,
      url: `${process.env.NEXT_PUBLIC_SITE_URL || "https://writeoffapp.com"}/blog/${p.slug}`,
    })),
  };

  return (
    <>
      <script
        type="application/ld+json"
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      {/* Hero */}
      <section className="relative overflow-hidden py-12 sm:py-16">
        <div className="relative mx-auto max-w-4xl px-4 text-center sm:px-6 lg:px-8">
          <div className="animate-hero-enter mb-4 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-4 py-1.5 text-sm font-medium text-primary">
            <Sparkles className="h-4 w-4" />
            Tax Tips &amp; Insights
          </div>
          <h1 className="animate-hero-enter-delay-1 text-3xl font-extrabold tracking-tight sm:text-4xl lg:text-5xl">
            <span className="text-foreground">Smart tax advice for </span>
            <span className="bg-gradient-to-r from-primary via-blue-500 to-cyan-500 bg-clip-text text-transparent">
              freelancers
            </span>
          </h1>
          <p className="animate-hero-enter-delay-2 mx-auto mt-4 max-w-2xl text-lg leading-relaxed text-muted-foreground">
            Practical guides on deductions, quarterly payments, expense tracking, and IRS filing so you keep more of what you earn.
          </p>
        </div>
      </section>

      {/* Post Grid */}
      <section className="mx-auto max-w-6xl px-4 pb-16 sm:px-6 lg:px-8">
        <ScrollRevealWrapper className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 stagger-children">
          {posts.map((post) => {
            const { style, tag, Icon } = getTagStyle(post.tags);
            return (
              <Link
                key={post.slug}
                href={`/blog/${post.slug}`}
                className="animate-on-scroll group flex flex-col overflow-hidden rounded-xl border border-border bg-card transition-all duration-300 hover:-translate-y-1 hover:border-primary/20 hover:shadow-xl hover:shadow-primary/5"
              >
                {/* Gradient cover */}
                <div className={`relative flex h-40 items-center justify-center bg-gradient-to-br ${style.gradient}`}>
                  {Icon && <Icon className={`h-16 w-16 ${style.iconColor}`} />}
                </div>

                <div className="flex flex-1 flex-col p-5">
                  <div className="mb-2">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${style.pillBg} ${style.pillText}`}>
                      {tag}
                    </span>
                  </div>
                  <h2 className="text-lg font-semibold text-foreground group-hover:text-primary transition-colors">
                    {post.title}
                  </h2>
                  <p className="mt-2 flex-1 text-sm leading-relaxed text-muted-foreground line-clamp-3">
                    {post.description}
                  </p>
                  <div className="mt-4 flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3.5 w-3.5" />
                      {new Date(post.date).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5" />
                      {post.readingTime} min read
                    </span>
                  </div>
                </div>
              </Link>
            );
          })}

          {/* CTA card */}
          <div className="animate-on-scroll flex flex-col items-center justify-center rounded-xl border border-dashed border-primary/30 bg-primary/5 p-6 text-center">
            <Sparkles className="mb-3 h-8 w-8 text-primary" />
            <h3 className="text-lg font-semibold text-foreground">Find your deductions</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              WriteOff&apos;s AI tracks expenses and finds write-offs automatically. Try free for 30 days.
            </p>
            <Link
              href="/welcome"
              className="mt-4 inline-flex items-center rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-white shadow-md transition-all hover:shadow-lg hover:brightness-110"
            >
              Get Started Free
            </Link>
          </div>
        </ScrollRevealWrapper>
      </section>
    </>
  );
}
