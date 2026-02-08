import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getTaskDisplay } from "@/lib/task-api";
import { requireAdminToken } from "@/lib/admin-auth";
import { normalizeTaskLabel } from "@/lib/task-labels";

export async function GET(request: Request) {
  const authError = requireAdminToken(request);
  if (authError) return authError;

  const db = getDb();
  const url = new URL(request.url);
  const lang = url.searchParams.get("lang");
  const tasks = await db
    .prepare(`SELECT * FROM tasks ORDER BY created_at DESC`)
    .all();
  const normalized = [];
  for (const task of tasks) {
    const display = await getTaskDisplay(db, task, lang);
    if (!task.deliverable) {
      await db
        .prepare(`UPDATE tasks SET deliverable = 'text' WHERE id = ?`)
        .run(task.id);
    }
    normalized.push({
      ...task,
      task_label: normalizeTaskLabel(task.task_label),
      deliverable: task.deliverable || "text",
      task_display: display.display,
      lang: display.lang,
      paid_status: task.paid_status ?? "unpaid"
    });
  }
  return NextResponse.json({ tasks: normalized });
}
