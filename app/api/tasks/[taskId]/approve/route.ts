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
    .prepare(`SELECT id, ai_account_id, status, submission_id FROM tasks WHERE id = ? AND deleted_at IS NULL`)
    .get<{ id: string; ai_account_id: string | null; status: string; submission_id: string | null }>(
      params.taskId
    );
  if (!task?.id) {
    return NextResponse.json({ status: "not_found" }, { status: 404 });
  }
  if (!task.ai_account_id || task.ai_account_id !== aiActor.id) {
    return NextResponse.json({ status: "unauthorized" }, { status: 401 });
  }
  if (task.status === "completed") {
    return NextResponse.json({ status: "completed", task_id: task.id });
  }
  if (task.status !== "review_pending") {
    return NextResponse.json(
      { status: "error", reason: "not_review_pending" },
      { status: 409 }
    );
  }
  if (!task.submission_id) {
    return NextResponse.json(
      { status: "error", reason: "missing_submission" },
      { status: 409 }
    );
  }

  await db.prepare(`UPDATE tasks SET status = 'completed' WHERE id = ?`).run(task.id);
  void dispatchTaskEvent(db, { eventType: "task.completed", taskId: task.id }).catch(() => {});

  return NextResponse.json({ status: "completed", task_id: task.id });
}
