import type { Metadata } from "next";
import Link from "next/link";
import { listBlogPosts } from "@/lib/blog";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Blog | Sinkai",
  description:
    "Sinkai for Agents blog. Implementation and operations guides for AI agents that execute real-world tasks."
};

const featuredSlugs = [
  "white-collar-ai-shift-overview",
  "white-collar-job-design-ai-human",
  "white-collar-ai-kpi-design",
  "white-collar-ai-transition-90days"
];

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
}

export default async function BlogIndexPage() {
  const posts = await listBlogPosts();
  const featuredPosts = featuredSlugs
    .map((slug) => posts.find((post) => post.slug === slug))
    .filter((post) => !!post);
  const featuredSlugSet = new Set(featuredPosts.map((post) => post.slug));
  const regularPosts = posts.filter((post) => !featuredSlugSet.has(post.slug));

  return (
    <div className="blog-page">
      <section className="blog-hero card">
        <p className="eyebrow">Blog</p>
        <h1>Sinkai for Agents ブログ一覧</h1>
        <p className="subtitle">
          AIエージェント実装者向けに、導入判断・接続・実装・運用を段階的にまとめています。
        </p>
      </section>

      <section className="blog-featured">
        <div className="blog-section-head">
          <h2>注目ブログ: AIで変化するホワイトカラー業務</h2>
          <p className="muted">まず読むべき4本を先頭にまとめています。</p>
        </div>
        <div className="blog-grid">
          {featuredPosts.map((post) => (
            <article key={post.slug} className="card blog-card blog-card-featured">
              <p className="blog-badge">注目</p>
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
        </div>
      </section>

      <section className="blog-section-head">
        <h2>その他のブログ</h2>
      </section>
      <section className="blog-grid">
        {regularPosts.map((post) => (
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
