import type { Metadata } from "next";
import Link from "next/link";
import { listBlogPosts } from "@/lib/blog";

export const metadata: Metadata = {
  title: "Blog | Sinkai",
  description:
    "Sinkai for Agents blog. Implementation and operations guides for AI agents that execute real-world tasks."
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
    hour12: false
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

  return (
    <div className="blog-page">
      <section className="blog-hero card">
        <p className="eyebrow">Blog</p>
        <h1>Sinkai for Agents ブログ一覧</h1>
        <p className="subtitle">
          AIエージェント実装者向けに、導入判断・接続・実装・運用を段階的にまとめています。
        </p>
      </section>

      <section className="blog-section-head">
        <h2>ブログ</h2>
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
