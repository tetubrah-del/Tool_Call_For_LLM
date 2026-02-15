import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { dispatchTaskEvent } from "@/lib/webhooks";
import { openContactChannel } from "@/lib/contact-channel";
import { queueTaskAcceptedHumanNotification } from "@/lib/notifications";
import { applyAiRateLimitHeaders, authenticateAiApiRequest, type AiAuthSuccess } from "@/lib/ai-api-auth";

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(
  request: Request,
  { params }: { params: { taskId: string } }
) {
  // This endpoint is intentionally AI-only.
  // Humans should apply first; AI selects an applicant to accept.
  const payload = await request.json().catch(() => null);
  const aiAccountId = normalizeText(payload?.ai_account_id);
  const aiApiKey = normalizeText(payload?.ai_api_key);
  const selectedHumanId = normalizeText(payload?.human_id);

  if (!aiAccountId || !aiApiKey || !selectedHumanId) {
    return NextResponse.json({ status: "error", reason: "invalid_request" }, { status: 400 });
  }

  const db = getDb();
  let aiAuth: AiAuthSuccess | null = null;
  function respond(body: any, status = 200) {
    let response = NextResponse.json(body, { status });
    if (aiAuth) response = applyAiRateLimitHeaders(response, aiAuth);
    return response;
  }

  const auth = await authenticateAiApiRequest(aiAccountId, aiApiKey);
  if (auth.ok === false) return auth.response;
  aiAuth = auth;

  const aiAccount = await db
    .prepare(`SELECT id FROM ai_accounts WHERE id = ? AND deleted_at IS NULL`)
    .get<{ id: string }>(aiAccountId);
  if (!aiAccount?.id) {
    return respond({ status: "unauthorized" }, 401);
  }

  const task = await db
    .prepare(`SELECT id, status, human_id, ai_account_id FROM tasks WHERE id = ? AND deleted_at IS NULL`)
    .get<{ id: string; status: string; human_id: string | null; ai_account_id: string | null }>(
      params.taskId
    );
  if (!task?.id) {
    return respond({ status: "not_found" }, 404);
  }
  if (!task.ai_account_id || task.ai_account_id !== aiAccountId) {
    return respond({ status: "unauthorized" }, 401);
  }
  if (task.status !== "open") {
    return respond({ status: "error", reason: "not_open" }, 409);
  }
  if (task.human_id) {
    return respond({ status: "error", reason: "already_assigned" }, 409);
  }

  const application = await db
    .prepare(`SELECT id FROM task_applications WHERE task_id = ? AND human_id = ?`)
    .get<{ id: string }>(params.taskId, selectedHumanId);
  if (!application?.id) {
    return respond({ status: "error", reason: "not_applied" }, 409);
  }

  const human = await db
    .prepare(`SELECT id, paypal_email FROM humans WHERE id = ? AND deleted_at IS NULL`)
    .get<{ id: string; paypal_email: string | null }>(selectedHumanId);
  if (!human?.id) {
    return respond({ status: "not_found" }, 404);
  }

  // Accept (assign) the selected applicant.
  await db
    .prepare(
      `UPDATE tasks SET status = 'accepted', human_id = ?, payee_paypal_email = ? WHERE id = ?`
    )
    .run(selectedHumanId, human.paypal_email, params.taskId);

  // Open contact channel immediately once assignment is accepted.
  await openContactChannel(db, params.taskId);

  // For future: store selected application_id on task; v0 does not persist selection metadata.
  void dispatchTaskEvent(db, { eventType: "task.accepted", taskId: params.taskId }).catch(
    () => {}
  );
  void queueTaskAcceptedHumanNotification(db, {
    taskId: params.taskId,
    humanId: selectedHumanId
  }).catch(() => {});

  return respond({
    status: "accepted",
    task_id: params.taskId,
    application_id: application.id
  });
}
