import crypto from "crypto";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { saveUpload } from "@/lib/storage";
import { getNormalizedTask } from "@/lib/task-api";
import { dispatchTaskEvent } from "@/lib/webhooks";

async function parseRequest(request: Request) {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return { type: "json", data: await request.json() };
  }
  const form = await request.formData();
  return { type: "form", data: form };
}

export async function POST(request: Request) {
  const parsed = await parseRequest(request);

  let taskId = "";
  let type: "photo" | "video" | "text" | "" = "";
  let text: string | null = null;
  let file: File | null = null;

  if (parsed.type === "json") {
    const payload: any = parsed.data;
    taskId = typeof payload?.task_id === "string" ? payload.task_id : "";
    type = typeof payload?.type === "string" ? payload.type : "";
    text = typeof payload?.text === "string" ? payload.text : null;
  } else {
    const form = parsed.data;
    taskId = typeof form.get("task_id") === "string" ? String(form.get("task_id")) : "";
    type = typeof form.get("type") === "string" ? (String(form.get("type")) as any) : "";
    const textValue = form.get("text");
    text = typeof textValue === "string" ? textValue : null;
    const upload = form.get("file");
    file = upload instanceof File ? upload : null;
  }

  if (!taskId || (type !== "photo" && type !== "video" && type !== "text")) {
    return NextResponse.json({ status: "error", reason: "invalid_request" }, { status: 400 });
  }

  const db = getDb();
  const task = await getNormalizedTask(db, taskId, "en");
  if (!task) {
    return NextResponse.json({ status: "not_found" }, { status: 404 });
  }

  if (task.status === "failed" && task.failure_reason === "timeout") {
    return NextResponse.json({ status: "error", reason: "timeout" }, { status: 409 });
  }

  if (task.deliverable && task.deliverable !== type) {
    return NextResponse.json({ status: "error", reason: "wrong_deliverable" }, { status: 400 });
  }

  let contentUrl: string | null = null;
  if (type === "text") {
    if (!text) {
      return NextResponse.json({ status: "error", reason: "missing_text" }, { status: 400 });
    }
  } else {
    if (!file) {
      return NextResponse.json({ status: "error", reason: "missing_file" }, { status: 400 });
    }
    contentUrl = await saveUpload(file);
  }

  const submissionId = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  db.prepare(
    `INSERT INTO submissions (id, task_id, type, content_url, text, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(submissionId, taskId, type, contentUrl, text, createdAt);

  db.prepare(`UPDATE tasks SET status = 'completed', submission_id = ? WHERE id = ?`).run(
    submissionId,
    taskId
  );
  if (task.human_id) {
    db.prepare(`UPDATE humans SET status = 'available' WHERE id = ?`).run(task.human_id);
  }
  void dispatchTaskEvent(db, { eventType: "task.completed", taskId }).catch(() => {});

  return NextResponse.json({ status: "stored", submission_id: submissionId });
}
