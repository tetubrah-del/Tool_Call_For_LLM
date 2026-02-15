import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { authenticateHumanRequest, finalizeHumanAuthResponse } from "@/lib/human-api-auth";

export async function GET(request: Request) {
  const auth = await authenticateHumanRequest(request, "profile:read");
  if (auth.ok === false) return auth.response;

  const db = getDb();
  const summary = await db
    .prepare(
      `SELECT
         COUNT(*) AS review_count,
         AVG(rating_overall) AS avg_rating
       FROM task_reviews
       WHERE reviewee_type = 'human'
         AND reviewee_id = ?
         AND is_hidden = 0
         AND published_at IS NOT NULL`
    )
    .get<{ review_count: number | string; avg_rating: number | string | null }>(auth.humanId);

  const reviewCount = Number(summary?.review_count ?? 0);
  const avgRatingRaw = summary?.avg_rating;
  const avgRating = avgRatingRaw == null ? null : Number(avgRatingRaw);

  const latest = await db
    .prepare(
      `SELECT id, task_id, rating_overall, comment, created_at, reviewer_type
       FROM task_reviews
       WHERE reviewee_type = 'human'
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
    }>(auth.humanId);

  const response = NextResponse.json({
    human_id: auth.humanId,
    review_count: reviewCount,
    avg_rating: Number.isFinite(avgRating) ? avgRating : null,
    latest
  });
  return finalizeHumanAuthResponse(request, response, auth);
}
