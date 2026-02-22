import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { normalizeCurrencyCode, usdToMinor } from "@/lib/currency-display";
import { currencyFromCountry2, normalizeCountry2 } from "@/lib/stripe";
import { computeReviewDeadlineAt } from "@/lib/task-reviews";
import { dispatchTaskEvent } from "@/lib/webhooks";
import { POST as createOrderRoute } from "@/app/api/stripe/orders/route";
import { authorizeOrderPayment, captureOrderAuthorization } from "@/lib/ai-billing";
import { verifyAiActorDetailed } from "../contact/_auth";

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function buildOrderId(taskId: string): string {
  return `order_${taskId}`;
}

function resolveBaseUrl(request: Request): string {
  const configured = (process.env.APP_BASE_URL || "").trim().replace(/\/+$/, "");
  if (configured) return configured;
  return new URL(request.url).origin;
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
  const payload: any = await request.json().catch(() => null);
  const aiAccountId = normalizeText(payload?.ai_account_id);
  const aiApiKey = normalizeText(payload?.ai_api_key);
  if (!aiAccountId || !aiApiKey) {
    return NextResponse.json({ status: "error", reason: "invalid_request" }, { status: 400 });
  }

  const db = getDb();
  const aiAuth = await verifyAiActorDetailed(db, aiAccountId, aiApiKey);
  if (aiAuth.ok === false) return aiAuth.response;
  const aiActor = aiAuth.actor;

  const existingOrder = await db
    .prepare(`SELECT id, version, currency, total_amount_jpy, status, checkout_session_id, payment_intent_id FROM orders WHERE task_id = ? ORDER BY created_at DESC LIMIT 1`)
    .get<{
      id: string;
      version: number;
      currency: string;
      total_amount_jpy: number;
      status: string;
      checkout_session_id: string | null;
      payment_intent_id: string | null;
    }>(taskId);

  const task = await db
    .prepare(`SELECT id, ai_account_id, status, submission_id, deliverable, human_id, budget_usd, quote_currency, quote_amount_minor FROM tasks WHERE id = ? AND deleted_at IS NULL`)
    .get<{
      id: string;
      ai_account_id: string | null;
      status: string;
      submission_id: string | null;
      deliverable: string | null;
      human_id: string | null;
      budget_usd: number;
      quote_currency: string | null;
      quote_amount_minor: number | null;
    }>(
      taskId
    );
  if (!task?.id) {
    return NextResponse.json({ status: "not_found" }, { status: 404 });
  }
  if (!task.ai_account_id || task.ai_account_id !== aiActor.id) {
    return NextResponse.json({ status: "unauthorized" }, { status: 401 });
  }
  if (task.status === "completed") {
    return NextResponse.json({
      status: "completed",
      task_id: task.id,
      payment:
        existingOrder?.id
          ? {
              status: existingOrder.status,
              order_id: existingOrder.id,
              version: existingOrder.version,
              currency: existingOrder.currency,
              amount_minor: Number(existingOrder.total_amount_jpy || 0),
              checkout_session_id: existingOrder.checkout_session_id
            }
          : null
    });
  }
  if (task.status !== "review_pending") {
    return NextResponse.json(
      { status: "error", reason: "not_review_pending" },
      { status: 409 }
    );
  }
  const reviewGuard = await db
    .prepare(
      `SELECT task_id, recognized_message_id, recognized_submission_id, has_attachment, attachment_checked, acceptance_checked, final_confirmed
       FROM task_review_guards
       WHERE task_id = ?`
    )
    .get<{
      task_id: string;
      recognized_message_id: string | null;
      recognized_submission_id: string | null;
      has_attachment: number;
      attachment_checked: number;
      acceptance_checked: number;
      final_confirmed: number;
    }>(task.id);
  if (!reviewGuard?.task_id) {
    return NextResponse.json(
      { status: "error", reason: "review_guard_missing" },
      { status: 409 }
    );
  }
  if (!reviewGuard.attachment_checked) {
    return NextResponse.json(
      { status: "error", reason: "attachment_not_checked" },
      { status: 409 }
    );
  }
  if (!reviewGuard.acceptance_checked) {
    return NextResponse.json(
      { status: "error", reason: "acceptance_not_checked" },
      { status: 409 }
    );
  }
  if (!reviewGuard.final_confirmed) {
    return NextResponse.json(
      { status: "error", reason: "final_confirmation_missing" },
      { status: 409 }
    );
  }
  if ((task.deliverable === "photo" || task.deliverable === "video") && !reviewGuard.has_attachment) {
    return NextResponse.json(
      { status: "error", reason: "missing_required_attachment" },
      { status: 409 }
    );
  }
  if (!task.submission_id && !reviewGuard.recognized_message_id && !reviewGuard.recognized_submission_id) {
    return NextResponse.json(
      { status: "error", reason: "missing_submission_evidence" },
      { status: 409 }
    );
  }

  if (!task.human_id) {
    return NextResponse.json({
      status: "error",
      reason: "missing_human"
    }, { status: 409 });
  }

  const human = await db
    .prepare(`SELECT country FROM humans WHERE id = ? AND deleted_at IS NULL`)
    .get<{ country: string | null }>(task.human_id);
  const payeeCountry = normalizeCountry2(human?.country || null);
  if (!payeeCountry) {
    return NextResponse.json(
      {
        status: "error",
        reason: "unsupported_payee_country",
        country: human?.country || null
      },
      { status: 409 }
    );
  }

  const orderCurrency = currencyFromCountry2(payeeCountry);
  const quoteCurrency = normalizeCurrencyCode(task.quote_currency);
  const quoteAmountMinor = Number(task.quote_amount_minor);
  const baseAmountMinor =
    quoteCurrency === orderCurrency && Number.isInteger(quoteAmountMinor) && quoteAmountMinor >= 0
      ? quoteAmountMinor
      : usdToMinor(Number(task.budget_usd || 0), orderCurrency);

  const baseUrl = resolveBaseUrl(request);
  const orderId = existingOrder?.id || buildOrderId(task.id);
  const orderVersion = Number(existingOrder?.version || 1);
  let orderTotalAmountMinor = Number(existingOrder?.total_amount_jpy ?? baseAmountMinor);

  if (!existingOrder?.id) {
    const orderCreateRequest = new Request(`${baseUrl}/api/stripe/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ai_account_id: aiAccountId,
        ai_api_key: aiApiKey,
        task_id: task.id,
        order_id: orderId,
        version: orderVersion,
        base_amount_minor: baseAmountMinor,
        fx_cost_minor: 0
      })
    });
    const orderCreateResponse = await createOrderRoute(orderCreateRequest);
    const orderCreateBody = await safeReadJson(orderCreateResponse);
    if (!orderCreateResponse.ok) {
      return NextResponse.json(
        {
          status: "error",
          reason: "create_order_failed",
          detail: orderCreateBody?.reason || "create_order_failed"
        },
        { status: 409 }
      );
    }
    orderTotalAmountMinor = Number(orderCreateBody?.order?.total_amount_jpy ?? baseAmountMinor);
  }

  let captureResult = await captureOrderAuthorization(db, {
    aiAccountId,
    orderId,
    orderVersion
  });
  if (captureResult.ok === false && captureResult.reason === "authorization_missing") {
    const authorizeResult = await authorizeOrderPayment(db, {
      aiAccountId,
      orderId,
      orderVersion
    });
    if (authorizeResult.ok === false) {
      return NextResponse.json(
        {
          status: "error",
          reason: "payment_authorization_failed",
          detail: authorizeResult.reason,
          message: authorizeResult.message || null
        },
        { status: 409 }
      );
    }
    captureResult = await captureOrderAuthorization(db, {
      aiAccountId,
      orderId,
      orderVersion
    });
  }
  if (captureResult.ok === false) {
    return NextResponse.json(
      {
        status: "error",
        reason: "payment_capture_failed",
        detail: captureResult.reason,
        message: captureResult.message || null
      },
      { status: 409 }
    );
  }

  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE tasks
       SET status = 'completed',
           review_pending_deadline_at = NULL,
           completed_at = ?,
           review_deadline_at = ?,
           paid_status = 'paid',
           paid_at = ?,
           paid_method = 'stripe',
           payment_error_message = NULL
       WHERE id = ?`
    )
    .run(now, computeReviewDeadlineAt(now), now, task.id);
  void dispatchTaskEvent(db, { eventType: "task.completed", taskId: task.id }).catch(() => {});

  return NextResponse.json({
    status: "completed",
    task_id: task.id,
    payment: {
      status: "captured",
      order_id: orderId,
      version: orderVersion,
      currency: orderCurrency,
      amount_minor: orderTotalAmountMinor,
      payment_intent_id: captureResult.value.payment_intent_id,
      capture_before: captureResult.value.capture_before,
      already_captured: captureResult.value.already_captured
    }
  });
}
