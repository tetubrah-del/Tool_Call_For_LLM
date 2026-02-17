import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireMarketingApiKey } from "@/lib/marketing-api-auth";

type RouteContext = {
  params: Promise<{ jobId: string }>;
};

function normalizeText(value: unknown, max = 200) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

export async function GET(request: Request, context: RouteContext) {
  const authError = requireMarketingApiKey(request);
  if (authError) return authError;

  const { jobId } = await context.params;
  const id = normalizeText(jobId, 120);
  if (!id) {
    return NextResponse.json({ status: "error", reason: "invalid_request" }, { status: 400 });
  }

  const db = getDb();
  const job = await db
    .prepare(
      `SELECT id, content_id, channel, scheduled_at, status,
              attempt_count, next_attempt_at, last_error, created_at, updated_at
       FROM marketing_publish_jobs
       WHERE id = ?`
    )
    .get(id);

  if (!job) {
    return NextResponse.json({ status: "not_found" }, { status: 404 });
  }

  const content = await db
    .prepare(
      `SELECT id, channel, status, title, body_text, hashtags_json, media_asset_url, updated_at
       FROM marketing_contents
       WHERE id = ?`
    )
    .get((job as any).content_id);

  const post = await db
    .prepare(
      `SELECT id, content_id, channel, external_post_id, post_url, published_at
       FROM marketing_posts
       WHERE content_id = ?
       ORDER BY published_at DESC
       LIMIT 1`
    )
    .get((job as any).content_id);

  return NextResponse.json({ status: "ok", job, content: content || null, post: post || null });
}
