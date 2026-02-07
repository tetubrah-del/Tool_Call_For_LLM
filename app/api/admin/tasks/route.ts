import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getTaskDisplay } from "@/lib/task-api";
import { requireAdminToken } from "@/lib/admin-auth";

export async function GET(request: Request) {
  const authError = requireAdminToken(request);
  if (authError) return authError;

  const db = getDb();
  const url = new URL(request.url);
  const lang = url.searchParams.get("lang");
  const tasks = db.prepare(`SELECT * FROM tasks ORDER BY created_at DESC`).all();
  const normalized = tasks.map((task: any) => {
    const display = getTaskDisplay(db, task, lang);
    if (!task.deliverable) {
      db.prepare(`UPDATE tasks SET deliverable = 'text' WHERE id = ?`).run(task.id);
    }
    return {
      ...task,
      deliverable: task.deliverable || "text",
      task_display: display.display,
      lang: display.lang,
      paid_status: task.paid_status ?? "unpaid"
    };
  });
  return NextResponse.json({ tasks: normalized });
}
