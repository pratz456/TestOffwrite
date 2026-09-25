import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';
import yaml from 'js-yaml';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const blogDirectory = path.join(root, 'content', 'blog');
const manifestPath = path.join(root, 'lib', 'blog-manifest.json');

const matterOptions = { engines: { yaml: { parse: (source) => yaml.load(source), stringify: (value) => yaml.dump(value) } } };

function isoDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return null;
}

const files = (await readdir(blogDirectory)).filter((file) => file.endsWith('.mdx')).sort();
const manifest = [];
for (const file of files) {
  const { data } = matter(await readFile(path.join(blogDirectory, file), 'utf8'), matterOptions);
  const slug = file.replace(/\.mdx$/, '');
  const date = isoDate(data.date);
  if (!date) throw new Error(`${file}: frontmatter "date" must be YYYY-MM-DD`);
  manifest.push({ slug, date, reviewed: isoDate(data.reviewed) });
}

await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`Wrote ${manifest.length} posts to ${path.relative(root, manifestPath)}.`);
