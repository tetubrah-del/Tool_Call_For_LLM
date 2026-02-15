import crypto from "crypto";
import { NextResponse } from "next/server";
import { getDb, type DbClient, type TaskReview } from "@/lib/db";
import {
  computeReviewDeadlineAt,
  isReviewWindowClosed,
  shouldRevealCounterpartyReview
} from "@/lib/task-reviews";
import { resolveActorFromRequest } from "../contact/_auth";

type TaskRow = {
  id: string;
  ai_account_id: string | null;
  human_id: string | null;
  status: string;
  completed_at: string | null;
  review_deadline_at: string | null;
};

function normalizeRating(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n);
  if (rounded < 1 || rounded > 5) return null;
  return rounded;
}

function normalizeComment(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 500);
}

function toReviewResponse(review: TaskReview) {
  return {
    id: review.id,
    task_id: review.task_id,
    reviewer_type: review.reviewer_type,
    reviewee_type: review.reviewee_type,
    rating_overall: review.rating_overall,
    comment: review.comment,
    created_at: review.created_at,
    updated_at: review.updated_at,
    published_at: review.published_at
  };
}

async function ensureReviewWindow(
  db: DbClient,
  task: TaskRow
): Promise<{ completedAt: string; reviewDeadlineAt: string }> {
  let completedAt = task.completed_at;
  if (!completedAt) {
    completedAt = new Date().toISOString();
  }
  let reviewDeadlineAt = task.review_deadline_at;
  if (!reviewDeadlineAt) {
    reviewDeadlineAt = computeReviewDeadlineAt(completedAt);
  }
  if (completedAt !== task.completed_at || reviewDeadlineAt !== task.review_deadline_at) {
    await db
      .prepare(
        `UPDATE tasks
         SET completed_at = ?, review_deadline_at = ?
         WHERE id = ?`
      )
      .run(completedAt, reviewDeadlineAt, task.id);
  }
  return { completedAt, reviewDeadlineAt };
}

async function maybePublishReviews(
  db: DbClient,
  taskId: string,
  reviewDeadlineAt: string,
  nowIso: string
): Promise<boolean> {
  const rows = await db
    .prepare(
      `SELECT reviewer_type
       FROM task_reviews
       WHERE task_id = ? AND is_hidden = 0`
    )
    .all<{ reviewer_type: "ai" | "human" }>(taskId);

  const hasAi = rows.some((row) => row.reviewer_type === "ai");
  const hasHuman = rows.some((row) => row.reviewer_type === "human");
  const shouldPublish = shouldRevealCounterpartyReview(
    hasAi && hasHuman,
    reviewDeadlineAt,
    Date.parse(nowIso)
  );
  if (!shouldPublish) return false;

  await db
    .prepare(
      `UPDATE task_reviews
       SET published_at = ?
       WHERE task_id = ? AND is_hidden = 0 AND published_at IS NULL`
    )
    .run(nowIso, taskId);
  return true;
}

async function loadTaskReviews(db: DbClient, taskId: string): Promise<TaskReview[]> {
  return db
    .prepare(
      `SELECT *
       FROM task_reviews
       WHERE task_id = ? AND is_hidden = 0
       ORDER BY created_at ASC`
    )
    .all<TaskReview>(taskId);
}

export async function GET(
  request: Request,
  { params }: { params: { taskId: string } }
) {
  const db = getDb();
  const task = await db
    .prepare(
      `SELECT id, ai_account_id, human_id, status, completed_at, review_deadline_at
       FROM tasks
       WHERE id = ? AND deleted_at IS NULL`
    )
    .get<TaskRow>(params.taskId);
  if (!task?.id) {
    return NextResponse.json({ status: "not_found" }, { status: 404 });
  }
  if (task.status !== "completed") {
    return NextResponse.json({ status: "error", reason: "not_reviewable" }, { status: 409 });
  }

  const actor = await resolveActorFromRequest(db, task, request);
  if (!actor) {
    return NextResponse.json({ status: "unauthorized" }, { status: 401 });
  }

  const { reviewDeadlineAt } = await ensureReviewWindow(db, task);
  const nowIso = new Date().toISOString();
  await maybePublishReviews(db, task.id, reviewDeadlineAt, nowIso);

  const reviews = await loadTaskReviews(db, task.id);
  const myReviewerType = actor.role;
  const counterpartyType = actor.role === "ai" ? "human" : "ai";
  const hasBothReviews =
    reviews.some((review) => review.reviewer_type === "ai") &&
    reviews.some((review) => review.reviewer_type === "human");
  const revealCounterparty = shouldRevealCounterpartyReview(hasBothReviews, reviewDeadlineAt);

  const myReview = reviews.find((review) => review.reviewer_type === myReviewerType) || null;
  const counterpartyReview = reviews.find((review) => review.reviewer_type === counterpartyType) || null;

  return NextResponse.json({
    status: "ok",
    task_id: task.id,
    review_deadline_at: reviewDeadlineAt,
    review_window_closed: isReviewWindowClosed(reviewDeadlineAt),
    my_review: myReview ? toReviewResponse(myReview) : null,
    counterparty_review:
      revealCounterparty && counterpartyReview ? toReviewResponse(counterpartyReview) : null
  });
}

export async function POST(
  request: Request,
  { params }: { params: { taskId: string } }
) {
  const payload: any = await request.json().catch(() => null);
  const ratingOverall = normalizeRating(payload?.rating_overall);
  const comment = normalizeComment(payload?.comment);
  if (ratingOverall === null) {
    return NextResponse.json({ status: "error", reason: "invalid_request" }, { status: 400 });
  }

  const db = getDb();
  const task = await db
    .prepare(
      `SELECT id, ai_account_id, human_id, status, completed_at, review_deadline_at
       FROM tasks
       WHERE id = ? AND deleted_at IS NULL`
    )
    .get<TaskRow>(params.taskId);
  if (!task?.id) {
    return NextResponse.json({ status: "not_found" }, { status: 404 });
  }
  if (task.status !== "completed") {
    return NextResponse.json({ status: "error", reason: "not_reviewable" }, { status: 409 });
  }

  const actor = await resolveActorFromRequest(db, task, request, payload);
  if (!actor) {
    return NextResponse.json({ status: "unauthorized" }, { status: 401 });
  }

  const reviewerType = actor.role;
  const reviewerId = actor.id;
  const revieweeType = actor.role === "ai" ? "human" : "ai";
  const revieweeId = actor.role === "ai" ? task.human_id : task.ai_account_id;
  if (!revieweeId) {
    return NextResponse.json({ status: "error", reason: "counterparty_missing" }, { status: 409 });
  }

  const { reviewDeadlineAt } = await ensureReviewWindow(db, task);
  if (isReviewWindowClosed(reviewDeadlineAt)) {
    return NextResponse.json(
      { status: "error", reason: "review_window_closed" },
      { status: 409 }
    );
  }

  const existing = await db
    .prepare(
      `SELECT id, published_at
       FROM task_reviews
       WHERE task_id = ? AND reviewer_type = ?
       LIMIT 1`
    )
    .get<{ id: string; published_at: string | null }>(task.id, reviewerType);

  if (existing?.published_at) {
    return NextResponse.json(
      { status: "error", reason: "review_already_published" },
      { status: 409 }
    );
  }

  const nowIso = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO task_reviews (
        id,
        task_id,
        reviewer_type,
        reviewer_id,
        reviewee_type,
        reviewee_id,
        rating_overall,
        comment,
        created_at,
        updated_at,
        published_at,
        is_hidden
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0)
      ON CONFLICT(task_id, reviewer_type) DO UPDATE SET
        rating_overall = excluded.rating_overall,
        comment = excluded.comment,
        updated_at = excluded.updated_at`
    )
    .run(
      existing?.id || crypto.randomUUID(),
      task.id,
      reviewerType,
      reviewerId,
      revieweeType,
      revieweeId,
      ratingOverall,
      comment,
      nowIso,
      nowIso
    );

  await maybePublishReviews(db, task.id, reviewDeadlineAt, nowIso);
  const reviews = await loadTaskReviews(db, task.id);
  const hasBothReviews =
    reviews.some((review) => review.reviewer_type === "ai") &&
    reviews.some((review) => review.reviewer_type === "human");
  const revealCounterparty = shouldRevealCounterpartyReview(hasBothReviews, reviewDeadlineAt);
  const myReview = reviews.find((review) => review.reviewer_type === reviewerType) || null;
  const counterpartyType = reviewerType === "ai" ? "human" : "ai";
  const counterpartyReview = reviews.find((review) => review.reviewer_type === counterpartyType) || null;

  return NextResponse.json({
    status: existing?.id ? "updated" : "created",
    task_id: task.id,
    review_deadline_at: reviewDeadlineAt,
    review_window_closed: isReviewWindowClosed(reviewDeadlineAt),
    my_review: myReview ? toReviewResponse(myReview) : null,
    counterparty_review:
      revealCounterparty && counterpartyReview ? toReviewResponse(counterpartyReview) : null
  });
}
