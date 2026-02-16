import crypto from "crypto";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getCurrentHumanIdByEmail } from "@/lib/human-session";

function normalizeBody(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

const MAX_COMMENT_LENGTH = 2000;
const MAX_COMMENTS_PER_TASK = 200;

export async function GET(
  _request: Request,
  { params }: any
) {
  const db = getDb();
  const task = await db
    .prepare(`SELECT id FROM tasks WHERE id = ? AND deleted_at IS NULL`)
    .get<{ id: string }>(params.taskId);
  if (!task?.id) {
    return NextResponse.json({ status: "not_found" }, { status: 404 });
  }

  const comments = await db
    .prepare(
      `SELECT c.id, c.task_id, c.human_id, h.name AS human_name, c.body, c.created_at
       FROM task_comments c
       LEFT JOIN humans h ON h.id = c.human_id
       WHERE c.task_id = ?
       ORDER BY c.created_at ASC
       LIMIT ${MAX_COMMENTS_PER_TASK}`
    )
    .all(params.taskId);

  return NextResponse.json({ comments });
}

export async function POST(
  request: Request,
  { params }: any
) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json({ status: "unauthorized" }, { status: 401 });
  }

  const db = getDb();
  const task = await db
    .prepare(`SELECT id FROM tasks WHERE id = ? AND deleted_at IS NULL`)
    .get<{ id: string }>(params.taskId);
  if (!task?.id) {
    return NextResponse.json({ status: "not_found" }, { status: 404 });
  }

  const humanId = await getCurrentHumanIdByEmail(email);
  if (!humanId) {
    return NextResponse.json({ status: "error", reason: "missing_human" }, { status: 409 });
  }

  const payload = await request.json().catch(() => null);
  const body = normalizeBody(payload?.body);
  if (!body) {
    return NextResponse.json({ status: "error", reason: "invalid_request" }, { status: 400 });
  }
  if (body.length > MAX_COMMENT_LENGTH) {
    return NextResponse.json({ status: "error", reason: "invalid_request" }, { status: 400 });
  }

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO task_comments (id, task_id, human_id, body, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(id, params.taskId, humanId, body, createdAt);

  const human = await db
    .prepare(`SELECT name FROM humans WHERE id = ? AND deleted_at IS NULL`)
    .get<{ name: string }>(humanId);

  return NextResponse.json({
    status: "created",
    comment: {
      id,
      task_id: params.taskId,
      human_id: humanId,
      human_name: human?.name || null,
      body,
      created_at: createdAt
    }
  });
}
