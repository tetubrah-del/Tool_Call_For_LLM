import crypto from "crypto";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  authenticateHumanRequest,
  finalizeHumanAuthResponse,
  type HumanAuthSuccess
} from "@/lib/human-api-auth";
import { saveUpload } from "@/lib/storage";
import { resolveActorFromRequest } from "../_auth";

function normalizeMessageBody(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

const MAX_MESSAGE_LENGTH = 4000;
const MAX_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024;

async function parsePayload(request: Request): Promise<{
  body: string;
  ai_account_id?: string;
  ai_api_key?: string;
  human_id?: string;
  human_test_token?: string;
  file: File | null;
}> {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const payload = await request.json().catch(() => null);
    return {
      body: normalizeMessageBody(payload?.body),
      ai_account_id:
        typeof payload?.ai_account_id === "string" ? payload.ai_account_id : undefined,
      ai_api_key: typeof payload?.ai_api_key === "string" ? payload.ai_api_key : undefined,
      human_id: typeof payload?.human_id === "string" ? payload.human_id : undefined,
      human_test_token:
        typeof payload?.human_test_token === "string" ? payload.human_test_token : undefined,
      file: null
    };
  }

  const form = await request.formData();
  const upload = form.get("file");
  return {
    body: normalizeMessageBody(form.get("body")),
    ai_account_id:
      typeof form.get("ai_account_id") === "string" ? String(form.get("ai_account_id")) : undefined,
    ai_api_key:
      typeof form.get("ai_api_key") === "string" ? String(form.get("ai_api_key")) : undefined,
    human_id:
      typeof form.get("human_id") === "string" ? String(form.get("human_id")) : undefined,
    human_test_token:
      typeof form.get("human_test_token") === "string"
        ? String(form.get("human_test_token"))
        : undefined,
    file: upload instanceof File ? upload : null
  };
}

export async function GET(
  request: Request,
  { params }: { params: { taskId: string } }
) {
  let humanAuth: HumanAuthSuccess | null = null;
  const db = getDb();
  const task = await db
    .prepare(`SELECT id, ai_account_id, human_id, status FROM tasks WHERE id = ? AND deleted_at IS NULL`)
    .get(params.taskId) as
    | { id: string; ai_account_id: string | null; human_id: string | null; status: string }
    | undefined;
  if (!task?.id) {
    return NextResponse.json({ status: "not_found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const qAiId = (url.searchParams.get("ai_account_id") || "").trim();
  const qAiKey = (url.searchParams.get("ai_api_key") || "").trim();
  let actor: { role: "ai" | "human"; id: string } | null = null;
  if (qAiId && qAiKey) {
    actor = await resolveActorFromRequest(db, task, request);
    if (!actor) {
      return NextResponse.json({ status: "unauthorized" }, { status: 401 });
    }
  } else {
    const auth = await authenticateHumanRequest(request, "messages:read");
    if (auth.ok === false) return auth.response;
    humanAuth = auth;
    if (task.human_id !== auth.humanId) {
      const unauthorized = NextResponse.json({ status: "unauthorized" }, { status: 401 });
      return finalizeHumanAuthResponse(request, unauthorized, auth);
    }
    actor = { role: "human", id: auth.humanId };
  }

  const channel = await db
    .prepare(`SELECT task_id, status, opened_at, closed_at FROM task_contacts WHERE task_id = ?`)
    .get(task.id) as
    | { task_id: string; status: "pending" | "open" | "closed"; opened_at: string | null; closed_at: string | null }
    | undefined;
  if (!channel?.task_id) {
    const response = NextResponse.json(
      { status: "error", reason: "contact_not_ready" },
      { status: 409 }
    );
    if (!humanAuth) return response;
    return finalizeHumanAuthResponse(request, response, humanAuth);
  }

  const messages = await db
    .prepare(
      `SELECT
         cm.id,
         cm.task_id,
         cm.sender_type,
         cm.sender_id,
         cm.body,
         cm.attachment_url,
         cm.created_at,
         cm.read_by_ai,
         cm.read_by_human,
         CASE
           WHEN cm.sender_type = 'ai' THEN COALESCE(
             (SELECT aa.name FROM ai_accounts aa WHERE aa.id = cm.sender_id),
             cm.sender_id
           )
           WHEN cm.sender_type = 'human' THEN COALESCE(
             (SELECT h.name FROM humans h WHERE h.id = cm.sender_id),
             cm.sender_id
           )
           ELSE cm.sender_id
         END AS sender_display
       FROM contact_messages cm
       WHERE task_id = ?
       ORDER BY cm.created_at ASC`
    )
    .all(task.id);

  const response = NextResponse.json({
    channel: {
      task_id: channel.task_id,
      status: channel.status,
      opened_at: channel.opened_at,
      closed_at: channel.closed_at
    },
    messages
  });
  if (!humanAuth) return response;
  return finalizeHumanAuthResponse(request, response, humanAuth);
}

export async function POST(
  request: Request,
  { params }: { params: { taskId: string } }
) {
  let humanAuth: HumanAuthSuccess | null = null;
  const payload = await parsePayload(request);
  const hasBody = payload.body.length > 0;
  const hasFile = payload.file instanceof File;
  if (!hasBody && !hasFile) {
    return NextResponse.json({ status: "error", reason: "invalid_request" }, { status: 400 });
  }
  if (payload.body.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json({ status: "error", reason: "invalid_request" }, { status: 400 });
  }
  if (hasFile && !payload.file.type.startsWith("image/")) {
    return NextResponse.json({ status: "error", reason: "invalid_file_type" }, { status: 400 });
  }
  if (hasFile && payload.file.size > MAX_ATTACHMENT_SIZE_BYTES) {
    return NextResponse.json({ status: "error", reason: "file_too_large" }, { status: 400 });
  }

  const db = getDb();
  const task = await db
    .prepare(`SELECT id, ai_account_id, human_id, status FROM tasks WHERE id = ? AND deleted_at IS NULL`)
    .get(params.taskId) as
    | { id: string; ai_account_id: string | null; human_id: string | null; status: string }
    | undefined;
  if (!task?.id) {
    return NextResponse.json({ status: "not_found" }, { status: 404 });
  }

  const hasAiCredentials =
    (typeof payload.ai_account_id === "string" && payload.ai_account_id.trim().length > 0) ||
    (typeof payload.ai_api_key === "string" && payload.ai_api_key.trim().length > 0);
  const hasHumanTestCredentials =
    (typeof payload.human_id === "string" && payload.human_id.trim().length > 0) ||
    (typeof payload.human_test_token === "string" && payload.human_test_token.trim().length > 0);

  let actor: { role: "ai" | "human"; id: string } | null = null;
  if (hasAiCredentials || hasHumanTestCredentials) {
    actor = await resolveActorFromRequest(db, task, request, payload);
    if (!actor) {
      return NextResponse.json({ status: "unauthorized" }, { status: 401 });
    }
  } else {
    const auth = await authenticateHumanRequest(request, "messages:write");
    if (auth.ok === false) return auth.response;
    humanAuth = auth;
    if (task.human_id !== auth.humanId) {
      const unauthorized = NextResponse.json({ status: "unauthorized" }, { status: 401 });
      return finalizeHumanAuthResponse(request, unauthorized, auth);
    }
    actor = { role: "human", id: auth.humanId };
  }

  const channel = await db
    .prepare(`SELECT task_id, status FROM task_contacts WHERE task_id = ?`)
    .get(task.id) as { task_id: string; status: "pending" | "open" | "closed" } | undefined;
  if (!channel?.task_id || channel.status !== "open") {
    const response = NextResponse.json(
      { status: "error", reason: "contact_not_open" },
      { status: 409 }
    );
    if (!humanAuth) return response;
    return finalizeHumanAuthResponse(request, response, humanAuth);
  }

  const attachmentUrl = hasFile ? await saveUpload(payload.file) : null;
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const readByAi = actor.role === "ai" ? 1 : 0;
  const readByHuman = actor.role === "human" ? 1 : 0;
  const senderDisplay =
    actor.role === "ai"
      ? (
          await db
            .prepare(`SELECT name FROM ai_accounts WHERE id = ?`)
            .get<{ name: string | null }>(actor.id)
        )?.name || actor.id
      : (
          await db
            .prepare(`SELECT name FROM humans WHERE id = ?`)
            .get<{ name: string | null }>(actor.id)
        )?.name || actor.id;
  await db.prepare(
    `INSERT INTO contact_messages
     (id, task_id, sender_type, sender_id, body, attachment_url, created_at, read_by_ai, read_by_human)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    task.id,
    actor.role,
    actor.id,
    payload.body,
    attachmentUrl,
    createdAt,
    readByAi,
    readByHuman
  );

  const response = NextResponse.json({
    status: "stored",
    message: {
      id,
      task_id: task.id,
      sender_type: actor.role,
      sender_id: actor.id,
      sender_display: senderDisplay,
      body: payload.body,
      attachment_url: attachmentUrl,
      created_at: createdAt,
      read_by_ai: readByAi,
      read_by_human: readByHuman
    }
  });
  if (!humanAuth) return response;
  return finalizeHumanAuthResponse(request, response, humanAuth);
}
