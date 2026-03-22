"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { Calendar, Clock, Sparkles } from "lucide-react";
import { BlogSearch } from "./blog-search";
import { ScrollRevealWrapper } from "./scroll-reveal-wrapper";

interface BlogPostMeta {
  slug: string;
  title: string;
  description: string;
  date: string;
  author: string;
  tags: string[];
  readingTime: number;
}

interface TagStyle {
  gradient: string;
  iconColor: string;
  pillBg: string;
  pillText: string;
}

interface BlogGridClientProps {
  posts: BlogPostMeta[];
  tagStyles: Record<string, TagStyle>;
  tagIcons: Record<string, string>;
}

// Map icon names to simple SVG paths for client-side rendering
const ICON_PATHS: Record<string, React.ReactNode> = {
  Receipt: (
    <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Zm4 5h8M8 11h8M8 15h5" strokeWidth="2" strokeLinecap="round" fill="none" stroke="currentColor" />
  ),
  Sparkles: (
    <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275Z" strokeWidth="2" fill="none" stroke="currentColor" />
  ),
  CalendarDays: (
    <path d="M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2ZM8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01" strokeWidth="2" strokeLinecap="round" fill="none" stroke="currentColor" />
  ),
  FileText: (
    <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7ZM14 2v4a2 2 0 0 0 2 2h4M10 9H8M16 13H8M16 17H8" strokeWidth="2" strokeLinecap="round" fill="none" stroke="currentColor" />
  ),
  FolderCheck: (
    <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2ZM9 13l2 2 4-4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" stroke="currentColor" />
  ),
};

function getTagStyle(tags: string[], tagStyles: Record<string, TagStyle>) {
  for (const tag of tags) {
    if (tagStyles[tag]) return { style: tagStyles[tag], tag };
  }
  return {
    style: tagStyles["Tax Deductions"] || { gradient: "from-blue-600 via-blue-500 to-indigo-500", iconColor: "text-white/25", pillBg: "bg-blue-100", pillText: "text-blue-700" },
    tag: tags[0] ?? "Guide",
  };
}

function getIconForTag(tag: string, tagIcons: Record<string, string>) {
  const iconName = tagIcons[tag] || "Receipt";
  return ICON_PATHS[iconName] || ICON_PATHS.Receipt;
}

export function BlogGridClient({ posts, tagStyles, tagIcons }: BlogGridClientProps) {
  const [query, setQuery] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);

  const handleFilter = useCallback((q: string, tag: string | null) => {
    setQuery(q);
    setActiveTag(tag);
  }, []);

  // Filter posts based on current query and tag
  let filteredPosts = posts;
  if (activeTag) {
    filteredPosts = filteredPosts.filter((p) => p.tags.includes(activeTag));
  }
  if (query.trim()) {
    const q = query.toLowerCase().trim();
    filteredPosts = filteredPosts.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.tags.some((t) => t.toLowerCase().includes(q))
    );
  }

  return (
    <>
      <BlogSearch posts={posts} onFilter={handleFilter} />

      <ScrollRevealWrapper className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 stagger-children">
        {filteredPosts.length === 0 && (
          <div className="col-span-full py-12 text-center">
            <p className="text-lg font-medium text-muted-foreground">No articles found</p>
            <p className="mt-1 text-sm text-muted-foreground">Try a different search term or clear your filters.</p>
          </div>
        )}

        {filteredPosts.map((post) => {
          const { style, tag } = getTagStyle(post.tags, tagStyles);
          const iconPath = getIconForTag(tag, tagIcons);
          return (
            <Link
              key={post.slug}
              href={`/blog/${post.slug}`}
              className="animate-on-scroll group flex flex-col overflow-hidden rounded-xl border border-border bg-card transition-all duration-300 hover:-translate-y-1 hover:border-primary/20 hover:shadow-xl hover:shadow-primary/5"
            >
              {/* Gradient cover with decorative elements */}
              <div className={`relative flex h-44 items-center justify-center bg-gradient-to-br ${style.gradient} overflow-hidden`}>
                {/* Decorative circles */}
                <div className="absolute -top-6 -right-6 h-24 w-24 rounded-full bg-white/10" />
                <div className="absolute -bottom-4 -left-4 h-16 w-16 rounded-full bg-white/8" />
                {/* Icon */}
                <svg viewBox="0 0 24 24" className={`h-14 w-14 ${style.iconColor} transition-transform group-hover:scale-110`}>
                  {iconPath}
                </svg>
                {/* Tag pill on the cover */}
                <span className="absolute bottom-3 left-3 rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-semibold text-white backdrop-blur-sm">
                  {tag}
                </span>
              </div>

              <div className="flex flex-1 flex-col p-5">
                <h2 className="text-lg font-semibold leading-snug text-foreground group-hover:text-primary transition-colors line-clamp-2">
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
    </>
  );
}
