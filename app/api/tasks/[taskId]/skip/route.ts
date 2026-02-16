import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { closeContactChannel } from "@/lib/contact-channel";

async function parseRequest(request: Request) {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return request.json();
  }
  const form = await request.formData();
  return Object.fromEntries(form.entries());
}

export async function POST(
  request: Request,
  { params }: any
) {
  const payload: any = await parseRequest(request);
  const humanId = typeof payload?.human_id === "string" ? payload.human_id : "";

  if (!humanId) {
    return NextResponse.json({ status: "error", reason: "missing_human" }, { status: 400 });
  }

  const db = getDb();
  const task = await db
    .prepare(`SELECT * FROM tasks WHERE id = ? AND deleted_at IS NULL`)
    .get(params.taskId);

  if (!task) {
    return NextResponse.json({ status: "not_found" }, { status: 404 });
  }

  if (task.status === "review_pending" || task.status === "completed") {
    return NextResponse.json({ status: "error", reason: "already_completed" }, { status: 409 });
  }

  if (task.human_id && task.human_id !== humanId) {
    return NextResponse.json({ status: "error", reason: "not_assigned" }, { status: 403 });
  }

  await db.prepare(`UPDATE tasks SET status = 'open', human_id = NULL, payee_paypal_email = NULL WHERE id = ?`).run(
    params.taskId
  );
  await closeContactChannel(db, params.taskId);

  return NextResponse.json({ status: "skipped", task_id: params.taskId });
}
