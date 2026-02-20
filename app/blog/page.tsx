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

type SortType = "recommended" | "new";
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
}

function parseSort(value: string | string[] | undefined): SortType {
  if (Array.isArray(value)) {
    return value[0] === "new" ? "new" : "recommended";
  }
  return value === "new" ? "new" : "recommended";
}

function sortByNewest<T extends { updatedAt: string }>(items: T[]): T[] {
  return [...items].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

export default async function BlogIndexPage({
  searchParams
}: {
  searchParams?: SearchParams;
}) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const sort = parseSort(resolvedSearchParams?.sort);
  const posts = await listBlogPosts();
  const featuredPosts = featuredSlugs
    .map((slug) => posts.find((post) => post.slug === slug))
    .filter((post) => !!post);
  const featuredSlugSet = new Set(featuredPosts.map((post) => post.slug));
  const regularPosts = posts.filter((post) => !featuredSlugSet.has(post.slug));
  const sortedRegularPosts = sort === "new" ? sortByNewest(regularPosts) : regularPosts;

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
        <div className="blog-sort">
          <span className="muted">並び順:</span>
          <Link
            href="/blog"
            className={sort === "recommended" ? "blog-sort-link active" : "blog-sort-link"}
          >
            おすすめ順
          </Link>
          <Link
            href="/blog?sort=new"
            className={sort === "new" ? "blog-sort-link active" : "blog-sort-link"}
          >
            新着順
          </Link>
        </div>
      </section>
      <section className="blog-grid">
        {sortedRegularPosts.map((post) => (
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
