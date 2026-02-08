import crypto from "crypto";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { resolveActorFromRequest } from "../_auth";

function normalizeMessageBody(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function GET(
  request: Request,
  { params }: { params: { taskId: string } }
) {
  const db = getDb();
  const task = db
    .prepare(`SELECT id, ai_account_id, human_id, status FROM tasks WHERE id = ?`)
    .get(params.taskId) as
    | { id: string; ai_account_id: string | null; human_id: string | null; status: string }
    | undefined;
  if (!task?.id) {
    return NextResponse.json({ status: "not_found" }, { status: 404 });
  }

  const actor = await resolveActorFromRequest(db, task, request);
  if (!actor) {
    return NextResponse.json({ status: "unauthorized" }, { status: 401 });
  }

  const channel = db
    .prepare(`SELECT task_id, status, opened_at, closed_at FROM task_contacts WHERE task_id = ?`)
    .get(task.id) as
    | { task_id: string; status: "pending" | "open" | "closed"; opened_at: string | null; closed_at: string | null }
    | undefined;
  if (!channel?.task_id) {
    return NextResponse.json(
      { status: "error", reason: "contact_not_ready" },
      { status: 409 }
    );
  }

  const messages = db
    .prepare(
      `SELECT id, task_id, sender_type, sender_id, body, created_at, read_by_ai, read_by_human
       FROM contact_messages
       WHERE task_id = ?
       ORDER BY created_at ASC`
    )
    .all(task.id);

  return NextResponse.json({
    channel: {
      task_id: channel.task_id,
      status: channel.status,
      opened_at: channel.opened_at,
      closed_at: channel.closed_at
    },
    messages
  });
}

export async function POST(
  request: Request,
  { params }: { params: { taskId: string } }
) {
  const payload = await request.json().catch(() => null);
  const message = normalizeMessageBody(payload?.body);
  if (!message) {
    return NextResponse.json({ status: "error", reason: "invalid_request" }, { status: 400 });
  }
  if (message.length > 4000) {
    return NextResponse.json({ status: "error", reason: "invalid_request" }, { status: 400 });
  }

  const db = getDb();
  const task = db
    .prepare(`SELECT id, ai_account_id, human_id, status FROM tasks WHERE id = ?`)
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

  const channel = db
    .prepare(`SELECT task_id, status FROM task_contacts WHERE task_id = ?`)
    .get(task.id) as { task_id: string; status: "pending" | "open" | "closed" } | undefined;
  if (!channel?.task_id || channel.status !== "open") {
    return NextResponse.json(
      { status: "error", reason: "contact_not_open" },
      { status: 409 }
    );
  }

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const readByAi = actor.role === "ai" ? 1 : 0;
  const readByHuman = actor.role === "human" ? 1 : 0;
  db.prepare(
    `INSERT INTO contact_messages
     (id, task_id, sender_type, sender_id, body, created_at, read_by_ai, read_by_human)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, task.id, actor.role, actor.id, message, createdAt, readByAi, readByHuman);

  return NextResponse.json({
    status: "stored",
    message: {
      id,
      task_id: task.id,
      sender_type: actor.role,
      sender_id: actor.id,
      body: message,
      created_at: createdAt,
      read_by_ai: readByAi,
      read_by_human: readByHuman
    }
  });
}
