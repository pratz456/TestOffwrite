"use client";

import { useState } from "react";
import { Search, X } from "lucide-react";

interface BlogPostMeta {
  slug: string;
  title: string;
  description: string;
  date: string;
  author: string;
  tags: string[];
  readingTime: number;
}

interface BlogSearchProps {
  posts: BlogPostMeta[];
  onFilter: (query: string, tag: string | null) => void;
}

export function BlogSearch({ posts, onFilter }: BlogSearchProps) {
  const [query, setQuery] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);

  // Extract unique tags sorted by frequency
  const popularTags: string[] = [];
  const tagCounts: Record<string, number> = {};
  for (const post of posts) {
    for (const tag of post.tags) {
      tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    }
  }
  Object.entries(tagCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .forEach(([tag]) => popularTags.push(tag));

  const handleQueryChange = (value: string) => {
    setQuery(value);
    onFilter(value, activeTag);
  };

  const handleTagClick = (tag: string) => {
    const newTag = activeTag === tag ? null : tag;
    setActiveTag(newTag);
    onFilter(query, newTag);
  };

  return (
    <div className="mb-8 space-y-4">
      {/* Search input */}
      <div className="relative max-w-xl mx-auto">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4.5 w-4.5 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search articles by title, topic, or keyword..."
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          className="w-full rounded-xl border border-border bg-card pl-10 pr-10 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-shadow shadow-sm"
        />
        {query && (
          <button
            onClick={() => handleQueryChange("")}
            className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Tag filter pills */}
      <div className="flex flex-wrap justify-center gap-2">
        {popularTags.map((tag) => (
          <button
            key={tag}
            type="button"
            onClick={() => handleTagClick(tag)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              activeTag === tag
                ? "bg-primary text-white"
                : "bg-muted text-muted-foreground hover:bg-primary/10 hover:text-primary"
            }`}
          >
            {tag}
          </button>
        ))}
      </div>
    </div>
  );
}
