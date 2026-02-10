import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getTaskDisplay } from "@/lib/task-api";
import { closeContactChannel } from "@/lib/contact-channel";
import { requireAdminToken } from "@/lib/admin-auth";
import { normalizeTaskLabel } from "@/lib/task-labels";
import { normalizePaymentStatus } from "@/lib/payments";

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function GET(request: Request) {
  const authError = requireAdminToken(request);
  if (authError) return authError;

  const db = getDb();
  const url = new URL(request.url);
  const lang = url.searchParams.get("lang");
  const q = (url.searchParams.get("q") || "").trim().toLowerCase();
  const includeDeleted = url.searchParams.get("include_deleted") === "1";
  const where: string[] = [];
  const params: Array<string | number | null> = [];
  if (!includeDeleted) {
    where.push("deleted_at IS NULL");
  }
  if (q) {
    where.push("(lower(task) LIKE ? OR id = ?)");
    params.push(`%${q}%`, q);
  }

  const tasks = await db
    .prepare(
      `SELECT * FROM tasks
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY created_at DESC`
    )
    .all(...params);
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
      paid_status: normalizePaymentStatus(task.paid_status)
    });
  }
  return NextResponse.json({ tasks: normalized });
}

export async function DELETE(request: Request) {
  const authError = requireAdminToken(request);
  if (authError) return authError;

  const payload: any = await request.json().catch(() => ({}));
  const id = normalizeText(payload?.id || payload?.task_id);
  if (!id) {
    return NextResponse.json({ status: "error", reason: "invalid_request" }, { status: 400 });
  }

  const db = getDb();
  const task = await db
    .prepare(`SELECT id, status, human_id FROM tasks WHERE id = ? AND deleted_at IS NULL`)
    .get<{ id: string; status: string; human_id: string | null }>(id);
  if (!task?.id) {
    return NextResponse.json({ status: "not_found" }, { status: 404 });
  }

  const now = new Date().toISOString();
  if (task.status === "accepted" && task.human_id) {
    await db.prepare(`UPDATE humans SET status = 'available' WHERE id = ?`).run(task.human_id);
  }

  // Hide it from normal flows and prevent stuck channels.
  await db
    .prepare(
      `UPDATE tasks
       SET deleted_at = ?,
           status = CASE WHEN status IN ('open','accepted') THEN 'failed' ELSE status END,
           failure_reason = CASE WHEN status IN ('open','accepted') THEN 'invalid_request' ELSE failure_reason END,
           human_id = CASE WHEN status IN ('open','accepted') THEN NULL ELSE human_id END
       WHERE id = ?`
    )
    .run(now, id);
  await closeContactChannel(db, id);

  return NextResponse.json({ status: "deleted", id, deleted_at: now });
}

export async function PATCH(request: Request) {
  const authError = requireAdminToken(request);
  if (authError) return authError;

  const payload: any = await request.json().catch(() => ({}));
  const id = normalizeText(payload?.id || payload?.task_id);
  if (!id) {
    return NextResponse.json({ status: "error", reason: "invalid_request" }, { status: 400 });
  }

  const db = getDb();
  const existing = await db.prepare(`SELECT id FROM tasks WHERE id = ?`).get<{ id: string }>(id);
  if (!existing?.id) {
    return NextResponse.json({ status: "not_found" }, { status: 404 });
  }

  await db.prepare(`UPDATE tasks SET deleted_at = NULL WHERE id = ?`).run(id);
  return NextResponse.json({ status: "restored", id });
}
