import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { dispatchTaskEvent } from "@/lib/webhooks";
import { openContactChannel } from "@/lib/contact-channel";
import { queueTaskAcceptedHumanNotification } from "@/lib/notifications";
import { applyAiRateLimitHeaders, authenticateAiApiRequest, type AiAuthSuccess } from "@/lib/ai-api-auth";
import { normalizeCurrencyCode, usdToMinor } from "@/lib/currency-display";
import { currencyFromCountry2, normalizeCountry2 } from "@/lib/stripe";
import { POST as createOrderRoute } from "@/app/api/stripe/orders/route";
import { authorizeOrderPayment } from "@/lib/ai-billing";

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

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

export async function POST(
  request: Request,
  context: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await context.params;
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
    .prepare(`SELECT id, status, human_id, ai_account_id, budget_usd, quote_currency, quote_amount_minor FROM tasks WHERE id = ? AND deleted_at IS NULL`)
    .get<{
      id: string;
      status: string;
      human_id: string | null;
      ai_account_id: string | null;
      budget_usd: number;
      quote_currency: string | null;
      quote_amount_minor: number | null;
    }>(
      taskId
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
    .get<{ id: string }>(taskId, selectedHumanId);
  if (!application?.id) {
    return respond({ status: "error", reason: "not_applied" }, 409);
  }

  const human = await db
    .prepare(`SELECT id, paypal_email, country FROM humans WHERE id = ? AND deleted_at IS NULL`)
    .get<{ id: string; paypal_email: string | null; country: string | null }>(selectedHumanId);
  if (!human?.id) {
    return respond({ status: "not_found" }, 404);
  }

  // Accept (assign) the selected applicant.
  await db
    .prepare(
      `UPDATE tasks SET status = 'accepted', human_id = ?, payee_paypal_email = ? WHERE id = ?`
    )
    .run(selectedHumanId, human.paypal_email, taskId);

  const payeeCountry = normalizeCountry2(human.country || null);
  if (!payeeCountry) {
    await db
      .prepare(
        `UPDATE tasks
         SET status = 'open',
             human_id = NULL,
             payee_paypal_email = NULL,
             payment_error_message = 'unsupported_payee_country'
         WHERE id = ?`
      )
      .run(taskId);
    return respond(
      { status: "error", reason: "payment_authorization_failed", detail: "unsupported_payee_country" },
      409
    );
  }
  const orderCurrency = currencyFromCountry2(payeeCountry);
  const normalizedQuoteCurrency = normalizeCurrencyCode(task.quote_currency);
  const quoteAmountMinor = Number(task.quote_amount_minor);
  const baseAmountMinor =
    normalizedQuoteCurrency === orderCurrency && Number.isInteger(quoteAmountMinor) && quoteAmountMinor >= 0
      ? quoteAmountMinor
      : usdToMinor(Number(task.budget_usd || 0), orderCurrency);
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
         SET status = 'open',
             human_id = NULL,
             payee_paypal_email = NULL,
             payment_error_message = ?
         WHERE id = ?`
      )
      .run(String(orderCreateBody?.reason || "create_order_failed"), taskId);
    return respond(
      {
        status: "error",
        reason: "payment_authorization_failed",
        detail: orderCreateBody?.reason || "create_order_failed"
      },
      409
    );
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
         SET status = 'open',
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
    return respond(
      {
        status: "error",
        reason: "payment_authorization_failed",
        detail: authResult.reason,
        message: authResult.message || null
      },
      409
    );
  }

  // Open contact channel immediately once assignment is accepted.
  await openContactChannel(db, taskId);

  // For future: store selected application_id on task; v0 does not persist selection metadata.
  void dispatchTaskEvent(db, { eventType: "task.accepted", taskId: taskId }).catch(
    () => {}
  );
  void queueTaskAcceptedHumanNotification(db, {
    taskId: taskId,
    humanId: selectedHumanId
  }).catch(() => {});

  return respond({
    status: "accepted",
    task_id: taskId,
    application_id: application.id,
    payment: {
      status: "authorized",
      order_id: orderId,
      version: 1,
      payment_intent_id: authResult.value.payment_intent_id,
      capture_before: authResult.value.capture_before
    }
  });
}
