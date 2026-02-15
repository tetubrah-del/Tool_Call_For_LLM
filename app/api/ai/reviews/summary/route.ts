import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAiActorDetailed } from "../../../tasks/[taskId]/contact/_auth";
import { parseAiAccountIdFromRequest, parseAiApiKeyFromRequest } from "@/lib/ai-api-auth";

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const aiAccountId = normalizeText(parseAiAccountIdFromRequest(request, url));
  const aiApiKey = normalizeText(parseAiApiKeyFromRequest(request));
  if (!aiAccountId || !aiApiKey) {
    return NextResponse.json({ status: "error", reason: "invalid_request" }, { status: 400 });
  }

  const db = getDb();
  const aiAuth = await verifyAiActorDetailed(db, aiAccountId, aiApiKey);
  if (aiAuth.ok === false) return aiAuth.response;
  const aiActor = aiAuth.actor;

  const summary = await db
    .prepare(
      `SELECT
         COUNT(*) AS review_count,
         AVG(rating_overall) AS avg_rating
       FROM task_reviews
       WHERE reviewee_type = 'ai'
         AND reviewee_id = ?
         AND is_hidden = 0
         AND published_at IS NOT NULL`
    )
    .get<{ review_count: number | string; avg_rating: number | string | null }>(aiActor.id);

  const reviewCount = Number(summary?.review_count ?? 0);
  const avgRatingRaw = summary?.avg_rating;
  const avgRating = avgRatingRaw == null ? null : Number(avgRatingRaw);

  const latest = await db
    .prepare(
      `SELECT id, task_id, rating_overall, comment, created_at, reviewer_type
       FROM task_reviews
       WHERE reviewee_type = 'ai'
         AND reviewee_id = ?
         AND is_hidden = 0
         AND published_at IS NOT NULL
       ORDER BY created_at DESC
       LIMIT 5`
    )
    .all<{
      id: string;
      task_id: string;
      rating_overall: number;
      comment: string | null;
      created_at: string;
      reviewer_type: "ai" | "human";
    }>(aiActor.id);

  return NextResponse.json({
    ai_account_id: aiActor.id,
    review_count: reviewCount,
    avg_rating: Number.isFinite(avgRating) ? avgRating : null,
    latest
  });
}
