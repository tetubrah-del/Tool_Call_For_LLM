import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { dispatchTaskEvent } from "@/lib/webhooks";
import { verifyAiActor } from "../contact/_auth";

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
  if (!aiAccountId || !aiApiKey) {
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
  if (task.status === "failed") {
    return NextResponse.json({ status: "rejected", task_id: task.id });
  }
  if (task.status !== "review_pending") {
    return NextResponse.json({ status: "error", reason: "not_review_pending" }, { status: 409 });
  }

  await db
    .prepare(
      `UPDATE tasks
       SET status = 'failed',
           failure_reason = 'requester_rejected',
           review_pending_deadline_at = NULL
       WHERE id = ?`
    )
    .run(task.id);
  void dispatchTaskEvent(db, { eventType: "task.failed", taskId: task.id }).catch(() => {});

  return NextResponse.json({ status: "rejected", task_id: task.id });
}
