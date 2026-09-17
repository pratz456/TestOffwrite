import fs from "fs";
import path from "path";
import matter from "gray-matter";
import yaml from "js-yaml";
import { remark } from "remark";
import remarkHtml from "remark-html";
import remarkGfm from "remark-gfm";

const BLOG_DIR = path.join(process.cwd(), "content", "blog");

const matterOptions: any = {
  engines: {
    yaml: {
      parse: (s: string) => yaml.load(s) as Record<string, unknown>,
      stringify: (o: Record<string, unknown>) => yaml.dump(o),
    },
  },
};

export interface BlogPost {
  slug: string;
  title: string;
  description: string;
  date: string;
  author: string;
  tags: string[];
  readingTime: number;
  contentHtml: string;
  hasMidCta: boolean;
  /** ISO date of the last editorial accuracy review (frontmatter `reviewed`). */
  reviewedAt: string | null;
  /** Tax years the review covered (frontmatter `reviewedFor`), e.g. "tax years 2025–2026". */
  reviewedFor: string | null;
}

export interface BlogPostMeta {
  slug: string;
  title: string;
  description: string;
  date: string;
  author: string;
  tags: string[];
  readingTime: number;
  reviewedAt: string | null;
  reviewedFor: string | null;
}

function estimateReadingTime(text: string): number {
  const words = text.trim().split(/\s+/).length;
  return Math.max(1, Math.round(words / 230));
}

// gray-matter hands back a Date for unquoted YAML dates and a string for quoted ones.
function normalizeReviewDate(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return null;
}

function readReviewFields(data: Record<string, unknown>): Pick<BlogPostMeta, "reviewedAt" | "reviewedFor"> {
  const reviewedAt = normalizeReviewDate(data.reviewed);
  const reviewedFor = typeof data.reviewedFor === "string" && data.reviewedFor.trim() ? data.reviewedFor.trim() : null;
  return { reviewedAt, reviewedFor: reviewedAt ? reviewedFor : null };
}

/** "2026-09-17" → "September 2026"; used for the dated review note shown on each post. */
export function formatReviewMonth(isoDate: string): string {
  const [year, month] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function getAllPosts(): BlogPostMeta[] {
  if (!fs.existsSync(BLOG_DIR)) return [];

  return fs
    .readdirSync(BLOG_DIR)
    .filter((f) => f.endsWith(".mdx"))
    .map((filename) => {
      const raw = fs.readFileSync(path.join(BLOG_DIR, filename), "utf-8");
      const { data, content } = matter(raw, matterOptions);
      return {
        slug: filename.replace(/\.mdx$/, ""),
        title: data.title ?? "",
        description: data.description ?? "",
        date: data.date ?? "",
        author: data.author ?? "WriteOff Team",
        tags: data.tags ?? [],
        readingTime: estimateReadingTime(content),
        ...readReviewFields(data),
      };
    })
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

const CTA_PLACEHOLDER = "<!--BLOG_CTA-->";

export async function getPostBySlug(slug: string): Promise<BlogPost | null> {
  const filePath = path.join(BLOG_DIR, `${slug}.mdx`);
  if (!fs.existsSync(filePath)) return null;

  const raw = fs.readFileSync(filePath, "utf-8");
  const { data, content } = matter(raw, matterOptions);

  const hasMidCta = content.includes("<BlogCTA");
  const cleaned = content.replace(/<BlogCTA\s*\/?>/, CTA_PLACEHOLDER);

  const result = await remark().use(remarkGfm).use(remarkHtml).process(cleaned);
  const contentHtml = result.toString();

  return {
    slug,
    title: data.title ?? "",
    description: data.description ?? "",
    date: data.date ?? "",
    author: data.author ?? "WriteOff Team",
    tags: data.tags ?? [],
    readingTime: estimateReadingTime(content),
    contentHtml,
    hasMidCta,
    ...readReviewFields(data),
  };
}

export function getAdjacentPosts(slug: string) {
  const posts = getAllPosts();
  const idx = posts.findIndex((p) => p.slug === slug);
  return {
    prev: idx < posts.length - 1 ? posts[idx + 1] : null,
    next: idx > 0 ? posts[idx - 1] : null,
  };
}
