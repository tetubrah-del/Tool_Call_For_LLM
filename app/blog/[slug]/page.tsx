import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getBlogPostBySlug, listBlogPosts } from "@/lib/blog";

export const dynamic = "force-static";

type Params = Promise<{ slug: string }>;

export async function generateStaticParams() {
  const posts = await listBlogPosts();
  return posts.map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({
  params
}: {
  params: Params;
}): Promise<Metadata> {
  const resolvedParams = await params;
  const post = await getBlogPostBySlug(resolvedParams.slug);

  if (!post) {
    return {
      title: "Article Not Found | Sinkai"
    };
  }

  return {
    title: `${post.title} | Sinkai`,
    description: post.description,
    alternates: {
      canonical: `/blog/${post.slug}`
    },
    openGraph: {
      title: `${post.title} | Sinkai`,
      description: post.description,
      type: "article",
      url: `/blog/${post.slug}`
    }
  };
}

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

export default async function BlogArticlePage({
  params
}: {
  params: Params;
}) {
  const resolvedParams = await params;
  const post = await getBlogPostBySlug(resolvedParams.slug);

  if (!post) {
    notFound();
  }

  const articleJsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    datePublished: post.publishedAt,
    dateModified: post.updatedAt,
    description: post.description,
    author: {
      "@type": "Organization",
      name: "Sinkai"
    }
  };

  return (
    <article className="blog-page blog-article card">
      <p className="muted">
        公開日: {formatDate(post.publishedAt)}
        {post.primaryKeyword ? ` / ${post.primaryKeyword}` : ""}
      </p>
      <h1>{post.title}</h1>
      <p className="blog-description">{post.description}</p>
      <div
        className="blog-prose"
        dangerouslySetInnerHTML={{
          __html: post.html
        }}
      />
      <div className="blog-footer-links">
        <Link href="/blog">ブログ一覧に戻る</Link>
        <Link href="/for-agents/quickstart">Quickstart</Link>
        <Link href="/for-agents/reference">Reference</Link>
      </div>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd) }}
      />
    </article>
  );
}
