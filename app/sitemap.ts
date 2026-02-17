import type { MetadataRoute } from "next";
import { listBlogPosts } from "@/lib/blog";

function getBaseUrl(): string {
  const candidate = process.env.NEXT_PUBLIC_APP_URL || "https://sinkai.tokyo";
  return candidate.endsWith("/") ? candidate.slice(0, -1) : candidate;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = getBaseUrl();
  const now = new Date();
  const staticPaths = [
    "",
    "/for-agents",
    "/for-agents/quickstart",
    "/for-agents/reference",
    "/blog",
    "/terms",
    "/privacy"
  ];

  const staticEntries: MetadataRoute.Sitemap = staticPaths.map((route) => ({
    url: `${baseUrl}${route}`,
    lastModified: now,
    changeFrequency: route === "/blog" ? "daily" : "weekly",
    priority: route === "" ? 1 : 0.7
  }));

  const posts = await listBlogPosts();
  const postEntries: MetadataRoute.Sitemap = posts.map((post) => ({
    url: `${baseUrl}/blog/${post.slug}`,
    lastModified: new Date(post.updatedAt),
    changeFrequency: "monthly",
    priority: 0.8
  }));

  return [...staticEntries, ...postEntries];
}

