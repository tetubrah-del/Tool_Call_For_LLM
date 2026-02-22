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
import { minorToUsd, normalizeCurrencyCode, usdToMinor } from "@/lib/currency-display";
import { currencyFromCountry2, normalizeCountry2 } from "@/lib/stripe";
import { POST as createOrderRoute } from "@/app/api/stripe/orders/route";
import { authorizeOrderPayment } from "@/lib/ai-billing";

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

function resolveBaseUrl(request: Request): string {
  const configured = (process.env.APP_BASE_URL || "").trim().replace(/\/+$/, "");
  if (configured) return configured;
  return new URL(request.url).origin;
}

function buildOrderId(taskId: string): string {
  return `order_${taskId}`;
}

async function safeReadJson(response: Response): Promise<any> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const idemKey = request.headers.get("Idempotency-Key")?.trim() || null;
  let payload: any = null;
  try {
    payload = await request.json();
  } catch {
    payload = null;
  }

  const task = typeof payload?.task === "string" ? payload.task.trim() : "";
  const budgetUsdRaw = Number(payload?.budget_usd);
  const currencyInput = normalizeCurrencyCode(payload?.currency);
  const amountMinorInput = payload?.amount_minor;
  const amountMinor =
    amountMinorInput == null || amountMinorInput === "" ? null : Number(amountMinorInput);
  const aiAccountId =
    typeof payload?.ai_account_id === "string" ? payload.ai_account_id.trim() : "";
  const aiApiKey =
    typeof payload?.ai_api_key === "string" ? payload.ai_api_key.trim() : "";
  const rawLocation =
    typeof payload?.location === "string" ? payload.location.trim() : "";
  const location = rawLocation.length > 0 ? rawLocation : null;
  const originCountry = normalizeCountry(payload?.origin_country);
  const quoteCurrency = currencyInput || (originCountry === "JP" ? "jpy" : "usd");
  const budgetUsd =
    amountMinor != null && Number.isInteger(amountMinor) && amountMinor >= 0
      ? minorToUsd(amountMinor, quoteCurrency)
      : budgetUsdRaw;
  const quoteAmountMinor =
    amountMinor != null && Number.isInteger(amountMinor) && amountMinor >= 0
      ? amountMinor
      : usdToMinor(budgetUsd, quoteCurrency);
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
  if (amountMinor != null && (!Number.isInteger(amountMinor) || amountMinor < 0)) {
    fieldErrors.push({ field: "amount_minor", code: "invalid_number" });
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
    `INSERT INTO tasks (id, task, task_en, location, budget_usd, quote_currency, quote_amount_minor, origin_country, task_label, acceptance_criteria, not_allowed, ai_account_id, payer_paypal_email, payee_paypal_email, deliverable, deadline_minutes, deadline_at, status, failure_reason, human_id, submission_id, paid_status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, 'open', NULL, NULL, NULL, 'pending', ?)`
  ).run(
    taskId,
    task,
    task,
    location,
    budgetUsd,
    quoteCurrency,
    quoteAmountMinor,
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
     WHERE deleted_at IS NULL
       ${location ? "AND location = ?" : ""}
     ORDER BY created_at ASC
     LIMIT 1`
  );
  const params = location ? [location] : [];
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

  const payeeCountry = normalizeCountry2((human as any)?.country || null);
  if (!payeeCountry) {
    await db
      .prepare(
        `UPDATE tasks
         SET status = 'failed',
             failure_reason = 'invalid_request',
             human_id = NULL,
             payee_paypal_email = NULL,
             payment_error_message = 'unsupported_payee_country'
         WHERE id = ?`
      )
      .run(taskId);
    void dispatchTaskEvent(db, { eventType: "task.failed", taskId }).catch(() => {});
    return respond({
      status: "rejected",
      reason: "payment_authorization_failed",
      detail: "unsupported_payee_country",
      task_id: taskId
    }, 409);
  }

  const orderCurrency = currencyFromCountry2(payeeCountry);
  const normalizedQuoteCurrency = normalizeCurrencyCode(quoteCurrency);
  const baseAmountMinor =
    normalizedQuoteCurrency === orderCurrency && Number.isInteger(quoteAmountMinor) && quoteAmountMinor >= 0
      ? quoteAmountMinor
      : usdToMinor(Number(budgetUsd || 0), orderCurrency);
  const baseUrl = resolveBaseUrl(request);
  const orderId = buildOrderId(taskId);
  const orderCreateRequest = new Request(`${baseUrl}/api/stripe/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ai_account_id: aiAccountId,
      ai_api_key: aiApiKey,
      task_id: taskId,
      order_id: orderId,
      version: 1,
      base_amount_minor: baseAmountMinor,
      fx_cost_minor: 0
    })
  });
  const orderCreateResponse = await createOrderRoute(orderCreateRequest);
  const orderCreateBody = await safeReadJson(orderCreateResponse);
  if (!orderCreateResponse.ok) {
    await db
      .prepare(
        `UPDATE tasks
         SET status = 'failed',
             failure_reason = 'invalid_request',
             human_id = NULL,
             payee_paypal_email = NULL,
             payment_error_message = ?
         WHERE id = ?`
      )
      .run(
        String(orderCreateBody?.reason || "create_order_failed"),
        taskId
      );
    void dispatchTaskEvent(db, { eventType: "task.failed", taskId }).catch(() => {});
    return respond({
      status: "rejected",
      reason: "payment_authorization_failed",
      detail: orderCreateBody?.reason || "create_order_failed",
      task_id: taskId
    }, 409);
  }

  const authResult = await authorizeOrderPayment(db, {
    aiAccountId,
    orderId,
    orderVersion: 1
  });
  if (authResult.ok === false) {
    await db
      .prepare(
        `UPDATE tasks
         SET status = 'failed',
             failure_reason = 'invalid_request',
             human_id = NULL,
             payee_paypal_email = NULL,
             payment_error_message = ?
         WHERE id = ?`
      )
      .run(String(authResult.reason), taskId);
    await db
      .prepare(
        `UPDATE orders
         SET status = 'failed_provider',
             provider_error = ?,
             updated_at = ?
         WHERE id = ? AND version = ?`
      )
      .run(String(authResult.reason), new Date().toISOString(), orderId, 1);
    void dispatchTaskEvent(db, { eventType: "task.failed", taskId }).catch(() => {});
    return respond({
      status: "rejected",
      reason: "payment_authorization_failed",
      detail: authResult.reason,
      message: authResult.message || null,
      task_id: taskId
    }, 409);
  }

  await openContactChannel(db, taskId);
  void dispatchTaskEvent(db, { eventType: "task.accepted", taskId }).catch(() => {});

  return respond({
    task_id: taskId,
    status: "accepted",
    payment: {
      status: "authorized",
      order_id: orderId,
      version: 1,
      payment_intent_id: authResult.value.payment_intent_id,
      capture_before: authResult.value.capture_before
    }
  });
}
