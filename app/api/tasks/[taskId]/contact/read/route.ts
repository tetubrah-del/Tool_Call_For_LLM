import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { resolveActorFromRequest } from "../_auth";

export async function PATCH(
  request: Request,
  { params }: { params: { taskId: string } }
) {
  const payload = await request.json().catch(() => null);
  const db = getDb();
  const task = await db
    .prepare(`SELECT id, ai_account_id, human_id, status FROM tasks WHERE id = ? AND deleted_at IS NULL`)
    .get(params.taskId) as
    | { id: string; ai_account_id: string | null; human_id: string | null; status: string }
    | undefined;
  if (!task?.id) {
    return NextResponse.json({ status: "not_found" }, { status: 404 });
  }

  const actor = await resolveActorFromRequest(db, task, request, payload);
  if (!actor) {
    return NextResponse.json({ status: "unauthorized" }, { status: 401 });
  }

  const channel = await db
    .prepare(`SELECT task_id, status FROM task_contacts WHERE task_id = ?`)
    .get(task.id) as { task_id: string; status: "pending" | "open" | "closed" } | undefined;
  if (!channel?.task_id) {
    return NextResponse.json(
      { status: "error", reason: "contact_not_ready" },
      { status: 409 }
    );
  }

  if (actor.role === "ai") {
    await db
      .prepare(`UPDATE contact_messages SET read_by_ai = 1 WHERE task_id = ?`)
      .run(task.id);
  } else {
    await db
      .prepare(`UPDATE contact_messages SET read_by_human = 1 WHERE task_id = ?`)
      .run(task.id);
  }

  return NextResponse.json({ status: "updated", task_id: task.id });
}
