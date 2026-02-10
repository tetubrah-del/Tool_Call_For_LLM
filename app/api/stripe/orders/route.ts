import crypto from "crypto";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  assertNonNegativeInt,
  computeIsInternational,
  computePlatformFeeJpyFloor,
  normalizeCountry2
} from "@/lib/stripe";

function badRequest(reason: string, detail?: any) {
  return NextResponse.json({ status: "error", reason, detail }, { status: 400 });
}

function conflict(reason: string, detail?: any) {
  return NextResponse.json({ status: "error", reason, detail }, { status: 409 });
}

async function requireAiCredentials(payload: any) {
  const aiAccountId =
    typeof payload?.ai_account_id === "string" ? payload.ai_account_id.trim() : "";
  const aiApiKey = typeof payload?.ai_api_key === "string" ? payload.ai_api_key.trim() : "";
  if (!aiAccountId || !aiApiKey) {
    return { ok: false as const, response: badRequest("invalid_request") };
  }
  const db = getDb();
  const aiAccount = (await db
    .prepare(`SELECT * FROM ai_accounts WHERE id = ? AND deleted_at IS NULL`)
    .get(aiAccountId)) as { id: string; api_key: string; status: string } | undefined;
  if (!aiAccount || aiAccount.api_key !== aiApiKey || aiAccount.status !== "active") {
    return { ok: false as const, response: NextResponse.json({ status: "error", reason: "unauthorized" }, { status: 401 }) };
  }
  return { ok: true as const, aiAccountId };
}

export async function POST(request: Request) {
  try {
    const payload: any = await request.json().catch(() => ({}));

    const auth = await requireAiCredentials(payload);
    if (!auth.ok) return auth.response;

    const taskId = typeof payload?.task_id === "string" ? payload.task_id.trim() : "";
    if (!taskId) return badRequest("missing_task_id");

    const orderIdRaw = typeof payload?.order_id === "string" ? payload.order_id.trim() : "";
    const orderId = orderIdRaw || `order_${crypto.randomUUID()}`;
    const version = payload?.version == null ? 1 : Number(payload.version);
    if (!Number.isInteger(version) || version <= 0) return badRequest("invalid_version");

    const baseAmountJpy = assertNonNegativeInt(payload?.base_amount_jpy, "base_amount_jpy");
    const fxCostJpy = payload?.fx_cost_jpy == null ? 0 : assertNonNegativeInt(payload?.fx_cost_jpy, "fx_cost_jpy");
    const totalAmountJpy = baseAmountJpy + fxCostJpy;
    const platformFeeJpy = computePlatformFeeJpyFloor(totalAmountJpy);

    const db = getDb();
    const task = (await db.prepare(`SELECT * FROM tasks WHERE id = ? AND deleted_at IS NULL`).get(taskId)) as
      | { id: string; origin_country: string | null; human_id: string | null }
      | undefined;
    if (!task) return NextResponse.json({ status: "error", reason: "task_not_found" }, { status: 404 });
    if (!task.human_id) return conflict("missing_human");

    const human = (await db.prepare(`SELECT * FROM humans WHERE id = ? AND deleted_at IS NULL`).get(task.human_id)) as
      | { id: string; country: string | null; stripe_account_id: string | null }
      | undefined;
    if (!human) return conflict("missing_human");

    const payerCountry = normalizeCountry2(task.origin_country);
    if (!payerCountry) return conflict("unsupported_payer_country", { origin_country: task.origin_country });
    const payeeCountry = normalizeCountry2(human.country);
    if (!payeeCountry) return conflict("unsupported_payee_country", { country: human.country });

    const destinationAccountId = (human.stripe_account_id || "").trim();
    if (!destinationAccountId.startsWith("acct_")) return conflict("missing_connect_account");

    const isInternational = computeIsInternational(payerCountry, payeeCountry);

    const now = new Date().toISOString();
    const existing = (await db
      .prepare(`SELECT * FROM orders WHERE id = ? AND version = ?`)
      .get(orderId, version)) as any | undefined;

    const normalizedOrder = {
      id: orderId,
      version,
      payment_flow: "checkout",
      status: "created",
      currency: "jpy",
      base_amount_jpy: baseAmountJpy,
      fx_cost_jpy: fxCostJpy,
      total_amount_jpy: totalAmountJpy,
      platform_fee_jpy: platformFeeJpy,
      payer_country: payerCountry,
      payee_country: payeeCountry,
      is_international: isInternational,
      destination_account_id: destinationAccountId,
      human_id: human.id,
      task_id: task.id
    };

    if (existing) {
      // Idempotent create: same (id,version) must match core truth fields.
      const mismatch: Record<string, any> = {};
      for (const key of [
        "payment_flow",
        "currency",
        "base_amount_jpy",
        "fx_cost_jpy",
        "total_amount_jpy",
        "platform_fee_jpy",
        "payer_country",
        "payee_country",
        "is_international",
        "destination_account_id",
        "human_id",
        "task_id"
      ]) {
        if (String(existing[key]) !== String((normalizedOrder as any)[key])) {
          mismatch[key] = { existing: existing[key], requested: (normalizedOrder as any)[key] };
        }
      }
      if (Object.keys(mismatch).length) {
        return conflict("order_conflict", { order_id: orderId, version, mismatch });
      }
      return NextResponse.json({ status: "ok", order: existing });
    }

    await db.prepare(
      `INSERT INTO orders (
        id, version, payment_flow, status, currency,
        base_amount_jpy, fx_cost_jpy, total_amount_jpy, platform_fee_jpy,
        payer_country, payee_country, is_international, destination_account_id,
        human_id, task_id,
        checkout_session_id, payment_intent_id, charge_id, mismatch_reason, provider_error,
        created_at, updated_at
      ) VALUES (?, ?, 'checkout', 'created', 'jpy', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, ?, ?)`
    ).run(
      orderId,
      version,
      baseAmountJpy,
      fxCostJpy,
      totalAmountJpy,
      platformFeeJpy,
      payerCountry,
      payeeCountry,
      isInternational,
      destinationAccountId,
      human.id,
      task.id,
      now,
      now
    );

    const created = await db
      .prepare(`SELECT * FROM orders WHERE id = ? AND version = ?`)
      .get(orderId, version);

    return NextResponse.json({ status: "ok", order: created });
  } catch (err: any) {
    console.error("POST /api/stripe/orders failed", err);
    const status = err?.statusCode && Number.isInteger(err.statusCode) ? err.statusCode : 500;
    return NextResponse.json(
      { status: "error", reason: status === 400 ? "invalid_request" : "internal_error" },
      { status }
    );
  }
}
