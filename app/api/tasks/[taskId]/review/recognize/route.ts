import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAiActorDetailed } from "../../contact/_auth";
import { computeReviewPendingDeadline } from "@/lib/review-pending";

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(
  request: Request,
  { params }: { params: { taskId: string } }
) {
  const payload: any = await request.json().catch(() => null);
  const aiAccountId = normalizeText(payload?.ai_account_id);
  const aiApiKey = normalizeText(payload?.ai_api_key);
  const messageId = normalizeText(payload?.message_id);

  if (!aiAccountId || !aiApiKey) {
    return NextResponse.json({ status: "error", reason: "invalid_request" }, { status: 400 });
  }

  const db = getDb();
  const aiAuth = await verifyAiActorDetailed(db, aiAccountId, aiApiKey);
  if (aiAuth.ok === false) return aiAuth.response;
  const aiActor = aiAuth.actor;

  const task = await db
    .prepare(
      `SELECT id, ai_account_id, status, submission_id
       FROM tasks
       WHERE id = ? AND deleted_at IS NULL`
    )
    .get<{
      id: string;
      ai_account_id: string | null;
      status: string;
      submission_id: string | null;
    }>(params.taskId);

  if (!task?.id) {
    return NextResponse.json({ status: "not_found" }, { status: 404 });
  }
  if (!task.ai_account_id || task.ai_account_id !== aiActor.id) {
    return NextResponse.json({ status: "unauthorized" }, { status: 401 });
  }
  if (task.status !== "accepted" && task.status !== "review_pending") {
    return NextResponse.json(
      { status: "error", reason: "invalid_task_status" },
      { status: 409 }
    );
  }

  const humanMessage = messageId
    ? await db
        .prepare(
          `SELECT id, attachment_url
           FROM contact_messages
           WHERE id = ? AND task_id = ? AND sender_type = 'human'`
        )
        .get<{ id: string; attachment_url: string | null }>(messageId, task.id)
    : await db
        .prepare(
          `SELECT id, attachment_url
           FROM contact_messages
           WHERE task_id = ? AND sender_type = 'human'
           ORDER BY created_at DESC
           LIMIT 1`
        )
        .get<{ id: string; attachment_url: string | null }>(task.id);

  if (!humanMessage?.id && !task.submission_id) {
    return NextResponse.json(
      { status: "error", reason: "missing_human_submission_signal" },
      { status: 409 }
    );
  }

  let hasAttachment = Boolean(humanMessage?.attachment_url);
  if (!hasAttachment && task.submission_id) {
    const submission = await db
      .prepare(`SELECT content_url FROM submissions WHERE id = ?`)
      .get<{ content_url: string | null }>(task.submission_id);
    hasAttachment = Boolean(submission?.content_url);
  }

  const now = new Date().toISOString();
  await db.prepare(
    `INSERT INTO task_review_guards (
      task_id,
      ai_account_id,
      recognized_message_id,
      recognized_submission_id,
      has_attachment,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(task_id) DO UPDATE SET
      ai_account_id = excluded.ai_account_id,
      recognized_message_id = COALESCE(excluded.recognized_message_id, task_review_guards.recognized_message_id),
      recognized_submission_id = COALESCE(excluded.recognized_submission_id, task_review_guards.recognized_submission_id),
      has_attachment = excluded.has_attachment,
      updated_at = excluded.updated_at`
  ).run(
    task.id,
    aiActor.id,
    humanMessage?.id ?? null,
    task.submission_id,
    hasAttachment ? 1 : 0,
    now,
    now
  );

  if (task.status === "accepted") {
    await db
      .prepare(
        `UPDATE tasks
         SET status = 'review_pending',
             review_pending_deadline_at = ?
         WHERE id = ?`
      )
      .run(computeReviewPendingDeadline(now), task.id);
  }

  return NextResponse.json({
    status: "recognized",
    task_id: task.id,
    recognized_message_id: humanMessage?.id ?? null,
    recognized_submission_id: task.submission_id,
    has_attachment: hasAttachment
  });
}
