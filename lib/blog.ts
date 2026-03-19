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
      const { data, content } = matter(raw, matterOptions);
      return {
        slug: filename.replace(/\.mdx$/, ""),
        title: data.title ?? "",
        description: data.description ?? "",
        date: data.date ?? "",
        author: data.author ?? "WriteOff Team",
        tags: data.tags ?? [],
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
