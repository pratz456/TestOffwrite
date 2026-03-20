import type { Metadata } from "next";
import Link from "next/link";
import { Calendar, Clock, Receipt, CalendarDays, FolderCheck, FileText, Sparkles, PlayCircle } from "lucide-react";
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
  // Core filing
  "Tax Deductions":           { gradient: "from-blue-600 via-blue-500 to-indigo-500",    iconColor: "text-white/25", pillBg: "bg-blue-100",    pillText: "text-blue-700" },
  "Self-Employed":            { gradient: "from-violet-600 via-violet-500 to-purple-500", iconColor: "text-white/25", pillBg: "bg-violet-100",  pillText: "text-violet-700" },
  "Quarterly Taxes":          { gradient: "from-emerald-600 via-emerald-500 to-teal-500", iconColor: "text-white/25", pillBg: "bg-emerald-100", pillText: "text-emerald-700" },
  "Schedule C":               { gradient: "from-amber-600 via-amber-500 to-orange-500",   iconColor: "text-white/25", pillBg: "bg-amber-100",   pillText: "text-amber-700" },
  "Tax Planning":             { gradient: "from-sky-600 via-sky-500 to-cyan-500",         iconColor: "text-white/25", pillBg: "bg-sky-100",     pillText: "text-sky-700" },
  "Tax Strategies":           { gradient: "from-teal-600 via-teal-500 to-green-500",      iconColor: "text-white/25", pillBg: "bg-teal-100",    pillText: "text-teal-700" },
  "Tax Filing":               { gradient: "from-indigo-600 via-indigo-500 to-blue-500",   iconColor: "text-white/25", pillBg: "bg-indigo-100",  pillText: "text-indigo-700" },
  "Tax Basics":               { gradient: "from-blue-500 via-sky-500 to-cyan-400",        iconColor: "text-white/25", pillBg: "bg-blue-100",    pillText: "text-blue-600" },
  // Income & compliance
  "1099 Forms":               { gradient: "from-orange-600 via-orange-500 to-amber-500",  iconColor: "text-white/25", pillBg: "bg-orange-100",  pillText: "text-orange-700" },
  "Tax Compliance":           { gradient: "from-red-600 via-rose-500 to-pink-500",        iconColor: "text-white/25", pillBg: "bg-red-100",     pillText: "text-red-700" },
  "Tax Reporting":            { gradient: "from-rose-600 via-rose-500 to-red-500",        iconColor: "text-white/25", pillBg: "bg-rose-100",    pillText: "text-rose-700" },
  "Tax Preparation":          { gradient: "from-fuchsia-600 via-fuchsia-500 to-purple-500", iconColor: "text-white/25", pillBg: "bg-fuchsia-100", pillText: "text-fuchsia-700" },
  // Business type  
  "Gig Economy":              { gradient: "from-green-600 via-emerald-500 to-teal-500",   iconColor: "text-white/25", pillBg: "bg-green-100",   pillText: "text-green-700" },
  "Side Hustle":              { gradient: "from-lime-600 via-green-500 to-emerald-500",   iconColor: "text-white/25", pillBg: "bg-lime-100",    pillText: "text-lime-700" },
  "S-Corporation":            { gradient: "from-cyan-600 via-sky-500 to-blue-500",        iconColor: "text-white/25", pillBg: "bg-cyan-100",    pillText: "text-cyan-700" },
  // IRS topics
  "IRS Survival Guide":       { gradient: "from-red-700 via-red-600 to-rose-500",        iconColor: "text-white/25", pillBg: "bg-red-100",     pillText: "text-red-800" },
  "IRS Audit":                { gradient: "from-red-600 via-orange-600 to-amber-600",    iconColor: "text-white/25", pillBg: "bg-red-100",     pillText: "text-red-700" },
  "IRS Notices":              { gradient: "from-orange-700 via-orange-600 to-red-500",   iconColor: "text-white/25", pillBg: "bg-orange-100",  pillText: "text-orange-800" },
  "Tax Debt":                 { gradient: "from-slate-700 via-slate-600 to-gray-600",    iconColor: "text-white/25", pillBg: "bg-slate-100",   pillText: "text-slate-700" },
  // Specific deductions
  "Business Meals":           { gradient: "from-amber-500 via-yellow-500 to-lime-500",   iconColor: "text-white/25", pillBg: "bg-amber-100",   pillText: "text-amber-700" },
  "Professional Development": { gradient: "from-violet-600 via-purple-500 to-indigo-500", iconColor: "text-white/25", pillBg: "bg-violet-100",  pillText: "text-violet-700" },
  "Augusta Rule":             { gradient: "from-green-700 via-emerald-600 to-teal-600",  iconColor: "text-white/25", pillBg: "bg-green-100",   pillText: "text-green-800" },
  "Family Employment":        { gradient: "from-pink-600 via-rose-500 to-fuchsia-500",   iconColor: "text-white/25", pillBg: "bg-pink-100",    pillText: "text-pink-700" },
  "Health Insurance":         { gradient: "from-cyan-600 via-blue-500 to-indigo-500",    iconColor: "text-white/25", pillBg: "bg-cyan-100",    pillText: "text-cyan-700" },
  "Retirement":               { gradient: "from-emerald-700 via-green-600 to-teal-600",  iconColor: "text-white/25", pillBg: "bg-emerald-100", pillText: "text-emerald-800" },
  // Complex/specialty
  "Cryptocurrency Taxes":     { gradient: "from-purple-600 via-violet-500 to-indigo-500", iconColor: "text-white/25", pillBg: "bg-purple-100",  pillText: "text-purple-700" },
  "Multi-State Taxes":        { gradient: "from-blue-700 via-indigo-600 to-purple-600",  iconColor: "text-white/25", pillBg: "bg-blue-100",    pillText: "text-blue-800" },
  "Remote Work":              { gradient: "from-sky-600 via-blue-500 to-violet-500",     iconColor: "text-white/25", pillBg: "bg-sky-100",     pillText: "text-sky-700" },
  "Worker Misclassification": { gradient: "from-orange-700 via-amber-600 to-yellow-500", iconColor: "text-white/25", pillBg: "bg-orange-100",  pillText: "text-orange-700" },
  "Bookkeeping":              { gradient: "from-teal-600 via-cyan-500 to-sky-500",       iconColor: "text-white/25", pillBg: "bg-teal-100",    pillText: "text-teal-700" },
  "Business Banking":         { gradient: "from-green-600 via-teal-500 to-cyan-500",     iconColor: "text-white/25", pillBg: "bg-green-100",   pillText: "text-green-700" },
  "Digital Business":         { gradient: "from-indigo-600 via-violet-500 to-purple-500", iconColor: "text-white/25", pillBg: "bg-indigo-100",  pillText: "text-indigo-700" },
  "Sales Tax":                { gradient: "from-yellow-600 via-amber-500 to-orange-500", iconColor: "text-white/25", pillBg: "bg-yellow-100",  pillText: "text-yellow-700" },
  "Wacky Tax Tales":          { gradient: "from-pink-600 via-fuchsia-500 to-purple-500", iconColor: "text-white/25", pillBg: "bg-pink-100",    pillText: "text-pink-700" },
  "Tax Court":                { gradient: "from-slate-600 via-gray-500 to-zinc-500",     iconColor: "text-white/25", pillBg: "bg-slate-100",   pillText: "text-slate-700" },
  "Business Gifts":           { gradient: "from-rose-600 via-pink-500 to-fuchsia-500",   iconColor: "text-white/25", pillBg: "bg-rose-100",    pillText: "text-rose-700" },
  "Net Operating Losses":     { gradient: "from-gray-700 via-slate-600 to-zinc-600",     iconColor: "text-white/25", pillBg: "bg-gray-100",    pillText: "text-gray-700" },
  "Self-Employment Tax":      { gradient: "from-violet-700 via-purple-600 to-indigo-600", iconColor: "text-white/25", pillBg: "bg-violet-100",  pillText: "text-violet-800" },
  "QBI Deduction":            { gradient: "from-blue-700 via-blue-600 to-sky-600",       iconColor: "text-white/25", pillBg: "bg-blue-100",    pillText: "text-blue-800" },
  "Hobby Loss Rules":         { gradient: "from-amber-700 via-yellow-600 to-orange-500", iconColor: "text-white/25", pillBg: "bg-amber-100",   pillText: "text-amber-800" },
  "Tax Refunds":              { gradient: "from-green-500 via-emerald-500 to-teal-400",  iconColor: "text-white/25", pillBg: "bg-green-100",   pillText: "text-green-700" },
  "Year-End Taxes":           { gradient: "from-indigo-700 via-blue-600 to-cyan-600",    iconColor: "text-white/25", pillBg: "bg-indigo-100",  pillText: "text-indigo-700" },
  "Multiple Income Streams":  { gradient: "from-teal-600 via-emerald-500 to-green-500",  iconColor: "text-white/25", pillBg: "bg-teal-100",    pillText: "text-teal-700" },
  "First Year Freelancer":    { gradient: "from-sky-600 via-blue-500 to-indigo-500",     iconColor: "text-white/25", pillBg: "bg-sky-100",     pillText: "text-sky-700" },
  "Delivery Driver Taxes":    { gradient: "from-lime-600 via-green-500 to-teal-500",     iconColor: "text-white/25", pillBg: "bg-lime-100",    pillText: "text-lime-700" },
  "Rideshare Taxes":          { gradient: "from-green-600 via-lime-500 to-emerald-500",  iconColor: "text-white/25", pillBg: "bg-green-100",   pillText: "text-green-700" },
  "Etsy Taxes":               { gradient: "from-orange-500 via-amber-500 to-yellow-400", iconColor: "text-white/25", pillBg: "bg-orange-100",  pillText: "text-orange-700" },
  "W-2 and 1099":             { gradient: "from-indigo-600 via-blue-500 to-sky-500",     iconColor: "text-white/25", pillBg: "bg-indigo-100",  pillText: "text-indigo-700" },
  "Expense Tracking":         { gradient: "from-violet-500 via-violet-400 to-blue-400",  iconColor: "text-white/25", pillBg: "bg-violet-100",  pillText: "text-violet-700" },
};

const TAG_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  "Tax Deductions": Receipt,
  "Self-Employed": Sparkles,
  "Quarterly Taxes": CalendarDays,
  "Schedule C": FileText,
  "Tax Planning": CalendarDays,
  "Tax Strategies": Sparkles,
  "Tax Filing": FileText,
  "Tax Basics": FileText,
  "1099 Forms": FileText,
  "Tax Compliance": FolderCheck,
  "Tax Reporting": FileText,
  "Tax Preparation": FolderCheck,
  "Gig Economy": Receipt,
  "IRS Survival Guide": FileText,
  "IRS Audit": FileText,
  "Retirement": Sparkles,
  "Bookkeeping": FolderCheck,
  "Business Banking": Receipt,
  "Expense Tracking": FolderCheck,
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
        {/* Tutorial videos placeholder */}
        <div className="mb-8 rounded-xl border border-border bg-card p-5 sm:p-6">
          <div className="mb-4 flex items-center gap-2">
            <PlayCircle className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold text-foreground">Tutorial Videos</h2>
          </div>
          <p className="mb-4 text-sm text-muted-foreground">
            Step-by-step video walkthroughs are coming soon. In the meantime, use the written guides below.
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[
              "Getting started with WriteOff",
              "How to categorize transactions",
              "How to prepare for filing",
            ].map((title) => (
              <div
                key={title}
                className="rounded-lg border border-dashed border-primary/30 bg-primary/5 p-4"
              >
                <div className="mb-2 flex items-center gap-2">
                  <PlayCircle className="h-4 w-4 text-primary" />
                  <span className="text-sm font-medium text-foreground">{title}</span>
                </div>
                <p className="text-xs text-muted-foreground">coming soon</p>
              </div>
            ))}
          </div>
        </div>

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
