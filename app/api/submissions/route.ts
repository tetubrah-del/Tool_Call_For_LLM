import crypto from "crypto";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { saveUpload } from "@/lib/storage";
import { getNormalizedTask } from "@/lib/task-api";
import { closeContactChannel } from "@/lib/contact-channel";
import {
  authenticateHumanRequest,
  finalizeHumanAuthResponse,
  type HumanAuthSuccess
} from "@/lib/human-api-auth";
import { computeReviewPendingDeadline } from "@/lib/review-pending";

function verifyTestHumanToken(humanId: string, token: string): boolean {
  if (!humanId || !token) return false;
  if (process.env.ENABLE_TEST_HUMAN_AUTH !== "true") return false;
  const secret = process.env.TEST_HUMAN_AUTH_SECRET || "";
  if (!secret) return false;
  const expected = crypto.createHmac("sha256", secret).update(humanId).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(token);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

async function verifyAiActor(db: ReturnType<typeof getDb>, aiAccountId: string, aiApiKey: string) {
  if (!aiAccountId || !aiApiKey) return null;
  const aiAccount = await db
    .prepare(`SELECT id, api_key, status FROM ai_accounts WHERE id = ? AND deleted_at IS NULL`)
    .get<{ id: string; api_key: string; status: string }>(aiAccountId);
  if (!aiAccount) return null;
  if (aiAccount.api_key !== aiApiKey || aiAccount.status !== "active") return null;
  return { id: aiAccount.id };
}

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
  let humanAuth: HumanAuthSuccess | null = null;

  let taskId = "";
  let type: "photo" | "video" | "text" | "" = "";
  let text: string | null = null;
  let file: File | null = null;
  let aiAccountId = "";
  let aiApiKey = "";
  let humanId = "";
  let humanTestToken = "";

  if (parsed.type === "json") {
    const payload: any = parsed.data;
    taskId = typeof payload?.task_id === "string" ? payload.task_id : "";
    type = typeof payload?.type === "string" ? payload.type : "";
    text = typeof payload?.text === "string" ? payload.text : null;
    aiAccountId = typeof payload?.ai_account_id === "string" ? payload.ai_account_id : "";
    aiApiKey = typeof payload?.ai_api_key === "string" ? payload.ai_api_key : "";
    humanId = typeof payload?.human_id === "string" ? payload.human_id : "";
    humanTestToken =
      typeof payload?.human_test_token === "string" ? payload.human_test_token : "";
  } else {
    const form = parsed.data;
    taskId = typeof form.get("task_id") === "string" ? String(form.get("task_id")) : "";
    type = typeof form.get("type") === "string" ? (String(form.get("type")) as any) : "";
    const textValue = form.get("text");
    text = typeof textValue === "string" ? textValue : null;
    const upload = form.get("file");
    file = upload instanceof File ? upload : null;
    aiAccountId =
      typeof form.get("ai_account_id") === "string" ? String(form.get("ai_account_id")) : "";
    aiApiKey =
      typeof form.get("ai_api_key") === "string" ? String(form.get("ai_api_key")) : "";
    humanId =
      typeof form.get("human_id") === "string" ? String(form.get("human_id")) : "";
    humanTestToken =
      typeof form.get("human_test_token") === "string"
        ? String(form.get("human_test_token"))
        : "";
  }

  if (!taskId || (type !== "photo" && type !== "video" && type !== "text")) {
    return NextResponse.json({ status: "error", reason: "invalid_request" }, { status: 400 });
  }

  const db = getDb();
  const task = await getNormalizedTask(db, taskId, "en");
  if (!task) {
    return NextResponse.json({ status: "not_found" }, { status: 404 });
  }

  async function respond(response: NextResponse) {
    if (!humanAuth) return response;
    return finalizeHumanAuthResponse(request, response, humanAuth);
  }

  // Require an actor to submit. We allow:
  // - AI: ai_account_id + ai_api_key (must match task.ai_account_id)
  // - Human: logged-in session (must match task.human_id)
  // - Test-only human: human_id + human_test_token (guarded by env flag)
  let actor: { role: "ai" | "human"; id: string } | null = null;
  if (aiAccountId && aiApiKey) {
    const aiActor = await verifyAiActor(db, aiAccountId.trim(), aiApiKey.trim());
    if (aiActor && task.ai_account_id === aiActor.id) {
      actor = { role: "ai", id: aiActor.id };
    }
  } else if (humanId && humanTestToken) {
    const hid = humanId.trim();
    const tok = humanTestToken.trim();
    if (task.human_id === hid && verifyTestHumanToken(hid, tok)) {
      actor = { role: "human", id: hid };
    }
  } else {
    const auth = await authenticateHumanRequest(request, "submissions:write");
    if (auth.ok === false) {
      return auth.response;
    }
    humanAuth = auth;
    if (task.human_id === auth.humanId) {
      actor = { role: "human", id: auth.humanId };
    }
  }
  if (!actor) {
    return respond(NextResponse.json({ status: "unauthorized" }, { status: 401 }));
  }

  if (task.status === "failed" && task.failure_reason === "timeout") {
    return respond(NextResponse.json({ status: "error", reason: "timeout" }, { status: 409 }));
  }

  // Only accepted tasks can be completed via submission.
  if (task.status !== "accepted" || !task.human_id) {
    return respond(NextResponse.json(
      { status: "error", reason: "not_assigned" },
      { status: 409 }
    ));
  }

  if (task.deliverable && task.deliverable !== type) {
    return respond(
      NextResponse.json({ status: "error", reason: "wrong_deliverable" }, { status: 400 })
    );
  }

  let contentUrl: string | null = null;
  if (type === "text") {
    if (!text) {
      return respond(
        NextResponse.json({ status: "error", reason: "missing_text" }, { status: 400 })
      );
    }
    if (file) {
      if (!file.type.startsWith("image/")) {
        return respond(
          NextResponse.json({ status: "error", reason: "invalid_file_type" }, { status: 400 })
        );
      }
      contentUrl = await saveUpload(file);
    }
  } else {
    if (!file) {
      return respond(
        NextResponse.json({ status: "error", reason: "missing_file" }, { status: 400 })
      );
    }
    contentUrl = await saveUpload(file);
  }

  const submissionId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const reviewPendingDeadlineAt = computeReviewPendingDeadline(createdAt);

  await db.prepare(
    `INSERT INTO submissions (id, task_id, type, content_url, text, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(submissionId, taskId, type, contentUrl, text, createdAt);

  await db
    .prepare(
      `UPDATE tasks
       SET status = 'review_pending',
           submission_id = ?,
           review_pending_deadline_at = ?
       WHERE id = ?`
    )
    .run(
      submissionId,
      reviewPendingDeadlineAt,
      taskId
    );
  if (task.human_id) {
    await db
      .prepare(`UPDATE humans SET status = 'available' WHERE id = ?`)
      .run(task.human_id);
  }
  await closeContactChannel(db, taskId);

  return respond(NextResponse.json({ status: "stored", submission_id: submissionId }));
}
