import type { Metadata } from "next";
import Link from "next/link";
import { listBlogPosts } from "@/lib/blog";

export const metadata: Metadata = {
  title: "Blog | Sinkai",
  description:
    "Sinkai for Agents のブログ一覧。現地確認、human-in-the-loop、AIエージェント導入運用の実務記事をまとめています。",
  alternates: {
    canonical: "/blog"
  }
};

type SortType = "recommended" | "new";
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function formatDate(value: string): string {
  return new Date(value).toLocaleString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Tokyo"
  });
}

function parseSort(value: string | string[] | undefined): SortType {
  if (Array.isArray(value)) {
    return value[0] === "recommended" ? "recommended" : "new";
  }
  return value === "recommended" ? "recommended" : "new";
}

function sortByNewest<T extends { publishedAt: string; order: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const timeDiff = new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
    if (timeDiff !== 0) return timeDiff;
    return b.order - a.order;
  });
}

export default async function BlogIndexPage({
  searchParams
}: {
  searchParams?: SearchParams;
}) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const sort = parseSort(resolvedSearchParams?.sort);
  const posts = await listBlogPosts();
  const sortedPosts = sort === "new" ? sortByNewest(posts) : posts;
  const featuredPosts = posts.slice(0, 3);

  return (
    <div className="blog-page">
      <section className="blog-hero card">
        <p className="eyebrow">Blog</p>
        <h1>Sinkai for Agents ブログ一覧</h1>
        <p className="subtitle">
          AIエージェント実装者向けに、現地確認、human-in-the-loop、導入運用を段階的にまとめています。
        </p>
        <div className="blog-footer-links">
          <Link href="/for-agents">for Agents</Link>
          <Link href="/for-agents/quickstart">Quickstart</Link>
          <Link href="/for-agents/reference">Reference</Link>
        </div>
      </section>

      <section className="blog-grid">
        <article className="card blog-card">
          <p className="muted">最初の導線</p>
          <h2>
            <Link href="/for-agents">AIエージェントに現実世界の実行力を足す</Link>
          </h2>
          <p>まずは product overview を見て、Sinkai が何を解決するかを短時間で把握します。</p>
          <Link className="text-link" href="/for-agents">
            for Agents を開く
          </Link>
        </article>
        <article className="card blog-card">
          <p className="muted">最短セットアップ</p>
          <h2>
            <Link href="/for-agents/quickstart">5分で接続する</Link>
          </h2>
          <p>MCP または API から最初の1件を試すための導入手順です。</p>
          <Link className="text-link" href="/for-agents/quickstart">
            Quickstart を開く
          </Link>
        </article>
        <article className="card blog-card">
          <p className="muted">主力テーマ</p>
          <h2>現地確認 / 人間レビュー / 日本語ローカル調査</h2>
          <p>
            ブログ全体は、AIだけでは完了しない業務を API/MCP で実行につなぐ実務テーマに集中します。
          </p>
        </article>
      </section>

      <section className="blog-section-head">
        <h2>おすすめ記事</h2>
      </section>
      <section className="blog-grid">
        {featuredPosts.map((post) => (
          <article key={`featured-${post.slug}`} className="card blog-card">
            <p className="muted">
              {formatDate(post.publishedAt)}
              {post.primaryKeyword ? ` / ${post.primaryKeyword}` : ""}
            </p>
            <h2>
              <Link href={`/blog/${post.slug}`}>{post.title}</Link>
            </h2>
            {post.excerpt && <p>{post.excerpt}</p>}
            <Link className="text-link" href={`/blog/${post.slug}`}>
              おすすめ記事を読む
            </Link>
          </article>
        ))}
      </section>

      <section className="blog-section-head">
        <h2>全記事</h2>
        <div className="blog-sort">
          <span className="muted">並び順:</span>
          <Link
            href="/blog?sort=recommended"
            className={sort === "recommended" ? "blog-sort-link active" : "blog-sort-link"}
          >
            おすすめ順
          </Link>
          <Link
            href="/blog"
            className={sort === "new" ? "blog-sort-link active" : "blog-sort-link"}
          >
            新着順
          </Link>
        </div>
      </section>
      <section className="blog-grid">
        {sortedPosts.map((post) => (
          <article key={post.slug} className="card blog-card">
            <p className="muted">
              {formatDate(post.publishedAt)}
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
