import "server-only";

import { promises as fs } from "node:fs";
import path from "node:path";
import { marked } from "marked";

export type BlogPost = {
  slug: string;
  title: string;
  description: string;
  primaryKeyword: string;
  excerpt: string;
  order: number;
  sourceFile: string;
  publishedAt: string;
  updatedAt: string;
  html: string;
};

const BLOG_DIR = path.join(process.cwd(), "docs", "seo", "for-agents-ja");
const EXCLUDED_FILES = new Set(["README.md"]);
const LEGACY_PUBLISHED_AT_BY_FILE: Record<string, string> = {
  "01-onsite-verification-api-intro.md": "2026-02-17",
  "02-mcp-quickstart.md": "2026-02-17",
  "03-call-human-fast-implementation.md": "2026-02-17",
  "04-no-human-timeout-ops.md": "2026-02-17",
  "05-real-estate-template.md": "2026-02-17",
  "06-jp-local-research-workflow.md": "2026-02-17",
  "07-white-collar-ai-shift-overview.md": "2026-02-18",
  "08-white-collar-job-design.md": "2026-02-18",
  "09-white-collar-kpi.md": "2026-02-18",
  "10-white-collar-transition-plan.md": "2026-02-18"
};

let postsPromise: Promise<BlogPost[]> | null = null;

function cleanMemoValue(value: string): string {
  return value.trim().replace(/^`+|`+$/g, "").trim();
}

function extractMemoValue(section: string, label: string): string | null {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = section.match(new RegExp(`-\\s*${escapedLabel}:\\s*(.+)`));
  return match?.[1] ? cleanMemoValue(match[1]) : null;
}

function stripSeoMemo(markdown: string): string {
  return markdown.replace(/\n## SEOメモ[\s\S]*?(?=\n##\s|$)/, "\n").trim();
}

function stripLeadingHeading(markdown: string): string {
  return markdown.replace(/^#\s+.+\n+/, "").trim();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function convertCtaSection(markdown: string): string {
  const lines = markdown.split("\n");
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() !== "## CTA") {
      out.push(line);
      i += 1;
      continue;
    }

    out.push(line);
    i += 1;

    while (i < lines.length && lines[i].trim() === "") {
      i += 1;
    }

    const ctaLinks: Array<{ label: string; url: string }> = [];
    while (i < lines.length) {
      const current = lines[i];
      if (current.startsWith("## ")) {
        break;
      }
      const match = current.match(/^\s*-\s*(.+?):\s*`(https?:\/\/[^`]+)`\s*$/);
      if (match) {
        ctaLinks.push({
          label: match[1].trim(),
          url: match[2].trim()
        });
      }
      i += 1;
    }

    if (ctaLinks.length > 0) {
      out.push('<div class="blog-cta-buttons">');
      for (const link of ctaLinks) {
        out.push(
          `<a class="blog-cta-button" href="${escapeHtml(link.url)}">${escapeHtml(link.label)}</a>`
        );
      }
      out.push("</div>");
    }
  }

  return out.join("\n");
}

function extractExcerpt(markdown: string): string {
  const withoutCode = markdown.replace(/```[\s\S]*?```/g, "");
  const paragraphs = withoutCode
    .split(/\n\s*\n/)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0)
    .filter((chunk) => !chunk.startsWith("#"))
    .filter((chunk) => !chunk.startsWith("- "))
    .filter((chunk) => !chunk.startsWith("* "))
    .filter((chunk) => !/^\d+\.\s/.test(chunk))
    .filter((chunk) => !chunk.startsWith("|"));
  return paragraphs[0] || "";
}

async function parsePost(fileName: string): Promise<BlogPost> {
  const fullPath = path.join(BLOG_DIR, fileName);
  const [content, stat] = await Promise.all([
    fs.readFile(fullPath, "utf8"),
    fs.stat(fullPath)
  ]);

  const titleMatch = content.match(/^#\s+(.+)$/m);
  const title = titleMatch?.[1]?.trim() || fileName.replace(/\.md$/, "");
  const seoSection = content.match(/## SEOメモ([\s\S]*?)(?=\n##\s|$)/)?.[1] || "";
  const slugFromMemo = extractMemoValue(seoSection, "slug案");
  const description =
    extractMemoValue(seoSection, "meta description案") ||
    `${title} | Sinkai for Agents`;
  const primaryKeyword = extractMemoValue(seoSection, "primary keyword") || "";
  const publishedAtFromMemo = extractMemoValue(seoSection, "published_at");
  const orderMatch = fileName.match(/^(\d+)-/);
  const order = orderMatch ? Number(orderMatch[1]) : Number.MAX_SAFE_INTEGER;
  const fallbackSlug = fileName.replace(/^\d+-/, "").replace(/\.md$/, "");
  const slug = slugFromMemo || fallbackSlug;
  const publishedAt =
    publishedAtFromMemo || LEGACY_PUBLISHED_AT_BY_FILE[fileName] || stat.mtime.toISOString();

  const markdownBody = convertCtaSection(stripLeadingHeading(stripSeoMemo(content)));
  const excerpt = extractExcerpt(markdownBody);
  const html = await marked.parse(markdownBody);

  return {
    slug,
    title,
    description,
    primaryKeyword,
    excerpt,
    order,
    sourceFile: fileName,
    publishedAt,
    updatedAt: stat.mtime.toISOString(),
    html
  };
}

async function loadPosts(): Promise<BlogPost[]> {
  const fileNames = await fs.readdir(BLOG_DIR);
  const articleFiles = fileNames.filter(
    (fileName) => fileName.endsWith(".md") && !EXCLUDED_FILES.has(fileName)
  );
  const posts = await Promise.all(articleFiles.map((fileName) => parsePost(fileName)));
  return posts.sort((a, b) => a.order - b.order);
}

export async function listBlogPosts(): Promise<BlogPost[]> {
  if (!postsPromise) {
    postsPromise = loadPosts();
  }
  return postsPromise;
}

export async function getBlogPostBySlug(slug: string): Promise<BlogPost | null> {
  const posts = await listBlogPosts();
  return posts.find((post) => post.slug === slug) || null;
}
