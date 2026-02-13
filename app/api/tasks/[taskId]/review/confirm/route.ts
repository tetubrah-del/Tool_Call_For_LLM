import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAiActor } from "../../contact/_auth";

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1" || value === "true") return true;
  if (value === 0 || value === "0" || value === "false") return false;
  return null;
}

export async function POST(
  request: Request,
  { params }: { params: { taskId: string } }
) {
  const payload: any = await request.json().catch(() => null);
  const aiAccountId = normalizeText(payload?.ai_account_id);
  const aiApiKey = normalizeText(payload?.ai_api_key);
  const acceptanceChecked = normalizeBoolean(payload?.acceptance_checked);
  const attachmentChecked = normalizeBoolean(payload?.attachment_checked);
  const finalConfirmed = normalizeBoolean(payload?.final_confirmed);
  const reviewNote = typeof payload?.review_note === "string" ? payload.review_note.trim() : "";

  if (!aiAccountId || !aiApiKey) {
    return NextResponse.json({ status: "error", reason: "invalid_request" }, { status: 400 });
  }

  if (
    acceptanceChecked === null &&
    attachmentChecked === null &&
    finalConfirmed === null &&
    !reviewNote
  ) {
    return NextResponse.json({ status: "error", reason: "invalid_request" }, { status: 400 });
  }

  const db = getDb();
  const aiActor = await verifyAiActor(db, aiAccountId, aiApiKey);
  if (!aiActor?.id) {
    return NextResponse.json({ status: "unauthorized" }, { status: 401 });
  }

  const task = await db
    .prepare(`SELECT id, ai_account_id, status FROM tasks WHERE id = ? AND deleted_at IS NULL`)
    .get<{ id: string; ai_account_id: string | null; status: string }>(params.taskId);
  if (!task?.id) {
    return NextResponse.json({ status: "not_found" }, { status: 404 });
  }
  if (!task.ai_account_id || task.ai_account_id !== aiActor.id) {
    return NextResponse.json({ status: "unauthorized" }, { status: 401 });
  }
  if (task.status !== "review_pending") {
    return NextResponse.json(
      { status: "error", reason: "not_review_pending" },
      { status: 409 }
    );
  }

  const existing = await db
    .prepare(
      `SELECT task_id, attachment_checked, acceptance_checked, final_confirmed, review_note
       FROM task_review_guards
       WHERE task_id = ?`
    )
    .get<{
      task_id: string;
      attachment_checked: number;
      acceptance_checked: number;
      final_confirmed: number;
      review_note: string | null;
    }>(task.id);
  if (!existing?.task_id) {
    return NextResponse.json(
      { status: "error", reason: "review_guard_missing" },
      { status: 409 }
    );
  }

  const nextAttachmentChecked =
    attachmentChecked === null ? existing.attachment_checked : attachmentChecked ? 1 : 0;
  const nextAcceptanceChecked =
    acceptanceChecked === null ? existing.acceptance_checked : acceptanceChecked ? 1 : 0;
  const nextFinalConfirmed =
    finalConfirmed === null ? existing.final_confirmed : finalConfirmed ? 1 : 0;
  const nextReviewNote = reviewNote || existing.review_note || null;
  const now = new Date().toISOString();

  await db
    .prepare(
      `UPDATE task_review_guards
       SET attachment_checked = ?,
           acceptance_checked = ?,
           final_confirmed = ?,
           review_note = ?,
           updated_at = ?
       WHERE task_id = ?`
    )
    .run(
      nextAttachmentChecked,
      nextAcceptanceChecked,
      nextFinalConfirmed,
      nextReviewNote,
      now,
      task.id
    );

  return NextResponse.json({
    status: "updated",
    task_id: task.id,
    guard: {
      attachment_checked: Boolean(nextAttachmentChecked),
      acceptance_checked: Boolean(nextAcceptanceChecked),
      final_confirmed: Boolean(nextFinalConfirmed),
      review_note: nextReviewNote
    }
  });
}
