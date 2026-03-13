import type { Metadata } from "next";
import Link from "next/link";
import { listBlogPosts } from "@/lib/blog";

export const metadata: Metadata = {
  title: "Blog | Sinkai",
  description:
    "Sinkai のブログ一覧。現地確認、撮影、日本語調査など、人が受けられる仕事や働き方に関する記事をまとめています。",
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
        <h1>現地確認・撮影・調査の仕事ガイド</h1>
        <p className="subtitle">
          現地確認、写真撮影、日本語調査など、人が必要とされる仕事や働き方を段階的にまとめています。
        </p>
        <div className="blog-footer-links">
          <Link href="/auth">登録する</Link>
          <Link href="/tasks">案件一覧を見る</Link>
          <Link href="/me">マイページ</Link>
        </div>
      </section>

      <section className="blog-grid">
        <article className="card blog-card">
          <p className="muted">最初の一歩</p>
          <h2>
            <Link href="/auth">まずは登録して仕事を受けられる状態にする</Link>
          </h2>
          <p>案件応募やプロフィール作成の入口です。最初に登録を済ませると、仕事探しまで進みやすくなります。</p>
          <Link className="text-link" href="/auth">
            登録ページを開く
          </Link>
        </article>
        <article className="card blog-card">
          <p className="muted">案件を探す</p>
          <h2>
            <Link href="/tasks">今ある案件を一覧で見る</Link>
          </h2>
          <p>現地確認、撮影、調査など、今受けられる案件の一覧から自分に合う仕事を探せます。</p>
          <Link className="text-link" href="/tasks">
            案件一覧を開く
          </Link>
        </article>
        <article className="card blog-card">
          <p className="muted">主力テーマ</p>
          <h2>現地確認 / 写真撮影 / 日本語調査</h2>
          <p>
            ブログ全体は、AIではなく人が必要な仕事や、単発で受けやすい案件テーマに集中します。
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
