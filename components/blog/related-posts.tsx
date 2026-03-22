import Link from "next/link";
import { Calendar, Clock } from "lucide-react";
import type { BlogPostMeta } from "@/lib/blog";

interface RelatedPostsProps {
  currentSlug: string;
  currentTags: string[];
  allPosts: BlogPostMeta[];
  maxPosts?: number;
}

function getRelatedPosts(
  currentSlug: string,
  currentTags: string[],
  allPosts: BlogPostMeta[],
  maxPosts: number
): BlogPostMeta[] {
  const tagSet = new Set(currentTags);

  const scored = allPosts
    .filter((p) => p.slug !== currentSlug)
    .map((post) => {
      const overlap = post.tags.filter((t) => tagSet.has(t)).length;
      return { post, score: overlap };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || new Date(b.post.date).getTime() - new Date(a.post.date).getTime());

  return scored.slice(0, maxPosts).map((entry) => entry.post);
}

export function RelatedPosts({
  currentSlug,
  currentTags,
  allPosts,
  maxPosts = 3,
}: RelatedPostsProps) {
  const related = getRelatedPosts(currentSlug, currentTags, allPosts, maxPosts);

  if (related.length === 0) return null;

  return (
    <section className="mt-16 border-t border-border pt-10">
      <h2 className="text-xl font-bold text-foreground mb-6">Related Articles</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {related.map((post) => (
          <Link
            key={post.slug}
            href={`/blog/${post.slug}`}
            className="group rounded-xl border border-border bg-card p-5 transition-all hover:border-primary/20 hover:shadow-lg hover:shadow-primary/5"
          >
            <div className="mb-3 flex flex-wrap gap-1.5">
              {post.tags.slice(0, 2).map((tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary"
                >
                  {tag}
                </span>
              ))}
            </div>
            <h3 className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors line-clamp-2 mb-2">
              {post.title}
            </h3>
            <p className="text-xs text-muted-foreground line-clamp-2 mb-3">
              {post.description}
            </p>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                {new Date(post.date).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {post.readingTime} min
              </span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
