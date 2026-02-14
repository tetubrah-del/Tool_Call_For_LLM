import crypto from "crypto";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { MIN_BUDGET_USD } from "@/lib/payments";
import { normalizeCountry } from "@/lib/country";
import { normalizeTaskLabel } from "@/lib/task-labels";
import { finishIdempotency, startIdempotency } from "@/lib/idempotency";
import { dispatchTaskEvent } from "@/lib/webhooks";
import { openContactChannel } from "@/lib/contact-channel";
import { applyAiRateLimitHeaders, authenticateAiApiRequest, type AiAuthSuccess } from "@/lib/ai-api-auth";

type FieldError = {
  field: string;
  code:
    | "required"
    | "invalid_type"
    | "invalid_enum"
    | "invalid_number"
    | "below_min"
    | "invalid_credentials";
  message?: string;
};

export async function POST(request: Request) {
  const idemKey = request.headers.get("Idempotency-Key")?.trim() || null;
  let payload: any = null;
  try {
    payload = await request.json();
  } catch {
    payload = null;
  }

  const task = typeof payload?.task === "string" ? payload.task.trim() : "";
  const budgetUsd = Number(payload?.budget_usd);
  const aiAccountId =
    typeof payload?.ai_account_id === "string" ? payload.ai_account_id.trim() : "";
  const aiApiKey =
    typeof payload?.ai_api_key === "string" ? payload.ai_api_key.trim() : "";
  const rawLocation =
    typeof payload?.location === "string" ? payload.location.trim() : "";
  const location = rawLocation.length > 0 ? rawLocation : null;
  const originCountry = normalizeCountry(payload?.origin_country);
  const taskLabel = normalizeTaskLabel(payload?.task_label);
  const acceptanceCriteria =
    typeof payload?.acceptance_criteria === "string"
      ? payload.acceptance_criteria.trim()
      : "";
  const notAllowed =
    typeof payload?.not_allowed === "string" ? payload.not_allowed.trim() : "";
  const deliverable =
    payload?.deliverable === "photo" ||
    payload?.deliverable === "video" ||
    payload?.deliverable === "text"
      ? payload.deliverable
      : null;
  const normalizedDeliverable = deliverable || "text";
  const deadlineMinutes =
    payload?.deadline_minutes != null ? Number(payload.deadline_minutes) : null;
  const createdAt = new Date().toISOString();
  const deadlineAt =
    deadlineMinutes != null && Number.isFinite(deadlineMinutes)
      ? new Date(Date.parse(createdAt) + deadlineMinutes * 60 * 1000).toISOString()
      : null;

  const db = getDb();
  let aiAuth: AiAuthSuccess | null = null;
  const idemStart = await startIdempotency(db, {
    route: "/api/call_human",
    idemKey,
    aiAccountId: aiAccountId || null,
    payload
  });

  if (idemStart.replay) {
    return NextResponse.json(idemStart.body, {
      status: idemStart.statusCode,
      headers: idemKey ? { "Idempotency-Replayed": "true" } : undefined
    });
  }
  if (!idemStart.replay && idemStart.blocked) {
    return NextResponse.json(idemStart.body, { status: idemStart.statusCode });
  }

  async function respond(body: any, status = 200, headers?: HeadersInit) {
    await finishIdempotency(db, {
      route: "/api/call_human",
      idemKey,
      aiAccountId: aiAccountId || null,
      statusCode: status,
      responseBody: body
    });
    let response = NextResponse.json(body, { status, headers });
    if (aiAuth) {
      response = applyAiRateLimitHeaders(response, aiAuth);
    }
    return response;
  }

  const fieldErrors: FieldError[] = [];
  if (!task) fieldErrors.push({ field: "task", code: "required" });
  if (!Number.isFinite(budgetUsd)) {
    fieldErrors.push({ field: "budget_usd", code: "invalid_number" });
  }
  if (!aiAccountId) fieldErrors.push({ field: "ai_account_id", code: "required" });
  if (!aiApiKey) fieldErrors.push({ field: "ai_api_key", code: "required" });
  if (!taskLabel) {
    fieldErrors.push({
      field: "task_label",
      code: payload?.task_label == null ? "required" : "invalid_enum"
    });
  }
  if (!acceptanceCriteria) {
    fieldErrors.push({ field: "acceptance_criteria", code: "required" });
  }
  if (!notAllowed) fieldErrors.push({ field: "not_allowed", code: "required" });

  if (fieldErrors.length) {
    return respond(
      { status: "rejected", reason: "invalid_request", field_errors: fieldErrors },
      400
    );
  }
  if (!originCountry) {
    return respond(
      {
        status: "rejected",
        reason: "missing_origin_country",
        field_errors: [{ field: "origin_country", code: "required" }]
      },
      400
    );
  }
  if (budgetUsd < MIN_BUDGET_USD) {
    return respond(
      {
        status: "rejected",
        reason: "below_min_budget",
        field_errors: [{ field: "budget_usd", code: "below_min" }]
      },
      400
    );
  }

  const auth = await authenticateAiApiRequest(aiAccountId, aiApiKey);
  if (auth.ok === false) {
    if (auth.response.status === 429) {
      return respond(
        { status: "rejected", reason: "rate_limited" },
        429,
        Object.fromEntries(auth.response.headers.entries())
      );
    }
    return respond(
      {
        status: "rejected",
        reason: "invalid_request",
        field_errors: [{ field: "auth", code: "invalid_credentials" }]
      },
      400
    );
  }
  aiAuth = auth;
  const aiAccount = await db
    .prepare(`SELECT paypal_email FROM ai_accounts WHERE id = ?`)
    .get<{ paypal_email: string | null }>(aiAccountId);

  const taskId = crypto.randomUUID();
  await db.prepare(
    `INSERT INTO tasks (id, task, task_en, location, budget_usd, origin_country, task_label, acceptance_criteria, not_allowed, ai_account_id, payer_paypal_email, payee_paypal_email, deliverable, deadline_minutes, deadline_at, status, failure_reason, human_id, submission_id, paid_status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, 'open', NULL, NULL, NULL, 'pending', ?)`
  ).run(
    taskId,
    task,
    task,
    location,
    budgetUsd,
    originCountry,
    taskLabel,
    acceptanceCriteria,
    notAllowed,
    aiAccountId,
    aiAccount?.paypal_email || null,
    normalizedDeliverable,
    deadlineMinutes,
    deadlineAt,
    createdAt
  );

  const stmt = db.prepare(
    `SELECT * FROM humans
     WHERE status = 'available'
       AND deleted_at IS NULL
       AND min_budget_usd <= ?
       ${location ? "AND location = ?" : ""}
     ORDER BY min_budget_usd ASC
     LIMIT 1`
  );
  const params = location ? [budgetUsd, location] : [budgetUsd];
  const human = await stmt.get(...params);

  if (!human) {
    await db.prepare(
      `UPDATE tasks SET status = 'failed', failure_reason = 'no_human_available' WHERE id = ?`
    ).run(taskId);
    void dispatchTaskEvent(db, { eventType: "task.failed", taskId }).catch(() => {});
    return respond({ status: "rejected", reason: "no_human_available", task_id: taskId });
  }

  await db.prepare(`UPDATE tasks SET status = 'accepted', human_id = ? WHERE id = ?`).run(
    human.id,
    taskId
  );
  await db.prepare(`UPDATE tasks SET payee_paypal_email = ? WHERE id = ?`).run(
    human.paypal_email || null,
    taskId
  );
  await db.prepare(`UPDATE humans SET status = 'busy' WHERE id = ?`).run(human.id);
  await openContactChannel(db, taskId);
  // Payment is mocked for MVP; integrate Stripe here later if needed.
  void dispatchTaskEvent(db, { eventType: "task.accepted", taskId }).catch(() => {});

  return respond({
    task_id: taskId,
    status: "accepted"
  });
}
