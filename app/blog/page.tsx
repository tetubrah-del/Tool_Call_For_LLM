import type { Metadata } from "next";
import Link from "next/link";
import { listBlogPosts } from "@/lib/blog";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Blog | Sinkai",
  description:
    "Sinkai for Agents blog. Implementation and operations guides for AI agents that execute real-world tasks."
};

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
}

export default async function BlogIndexPage() {
  const posts = await listBlogPosts();

  return (
    <div className="blog-page">
      <section className="blog-hero card">
        <p className="eyebrow">Blog</p>
        <h1>Sinkai for Agents ブログ一覧</h1>
        <p className="subtitle">
          AIエージェント実装者向けに、導入判断・接続・実装・運用を段階的にまとめています。
        </p>
      </section>

      <section className="blog-grid">
        {posts.map((post) => (
          <article key={post.slug} className="card blog-card">
            <p className="muted">
              {formatDate(post.updatedAt)}
              {post.primaryKeyword ? ` / ${post.primaryKeyword}` : ""}
            </p>
            <h2>
              <Link href={`/blog/${post.slug}`}>{post.title}</Link>
            </h2>
            {post.excerpt && <p>{post.excerpt}</p>}
            <Link className="text-link" href={`/blog/${post.slug}`}>
              ブログを読む
            </Link>
          </article>
        ))}
      </section>
    </div>
  );
}
