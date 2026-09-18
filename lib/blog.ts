import fs from "fs";
import path from "path";
import { load as loadYaml } from "js-yaml";
import { remark } from "remark";
import remarkHtml from "remark-html";
import remarkGfm from "remark-gfm";

const BLOG_DIR = path.join(process.cwd(), "content", "blog");

function parseFrontMatter(raw: string): {
  data: Record<string, unknown>;
  content: string;
} {
  const normalized = raw.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  if (lines[0]?.trim() !== "---") {
    return { data: {}, content: normalized };
  }

  const closingIndex = lines.findIndex(
    (line, index) => index > 0 && line.trim() === "---",
  );
  if (closingIndex < 0) {
    throw new Error("Blog front matter is missing its closing delimiter.");
  }

  const parsed = loadYaml(lines.slice(1, closingIndex).join("\n"));
  const data =
    typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};

  return {
    data,
    content: lines.slice(closingIndex + 1).join("\n").replace(/^\n/, ""),
  };
}

function frontMatterString(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return fallback;
}

function frontMatterTags(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((tag): tag is string => typeof tag === "string")
    : [];
}

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
}

export interface BlogPostMeta {
  slug: string;
  title: string;
  description: string;
  date: string;
  author: string;
  tags: string[];
  readingTime: number;
}

function estimateReadingTime(text: string): number {
  const words = text.trim().split(/\s+/).length;
  return Math.max(1, Math.round(words / 230));
}

export function getAllPosts(): BlogPostMeta[] {
  if (!fs.existsSync(BLOG_DIR)) return [];

  return fs
    .readdirSync(BLOG_DIR)
    .filter((f) => f.endsWith(".mdx"))
    .map((filename) => {
      const raw = fs.readFileSync(path.join(BLOG_DIR, filename), "utf-8");
      const { data, content } = parseFrontMatter(raw);
      return {
        slug: filename.replace(/\.mdx$/, ""),
        title: frontMatterString(data.title),
        description: frontMatterString(data.description),
        date: frontMatterString(data.date),
        author: frontMatterString(data.author, "WriteOff Team"),
        tags: frontMatterTags(data.tags),
        readingTime: estimateReadingTime(content),
      };
    })
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

const CTA_PLACEHOLDER = "<!--BLOG_CTA-->";

export async function getPostBySlug(slug: string): Promise<BlogPost | null> {
  const filePath = path.join(BLOG_DIR, `${slug}.mdx`);
  if (!fs.existsSync(filePath)) return null;

  const raw = fs.readFileSync(filePath, "utf-8");
  const { data, content } = parseFrontMatter(raw);

  const hasMidCta = content.includes("<BlogCTA");
  const cleaned = content.replace(/<BlogCTA\s*\/?>/, CTA_PLACEHOLDER);

  const result = await remark().use(remarkGfm).use(remarkHtml).process(cleaned);
  const contentHtml = result.toString();

  return {
    slug,
    title: frontMatterString(data.title),
    description: frontMatterString(data.description),
    date: frontMatterString(data.date),
    author: frontMatterString(data.author, "WriteOff Team"),
    tags: frontMatterTags(data.tags),
    readingTime: estimateReadingTime(content),
    contentHtml,
    hasMidCta,
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
