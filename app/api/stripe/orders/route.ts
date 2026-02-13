import crypto from "crypto";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  assertNonNegativeInt,
  computeIsInternational,
  computeIntlSurchargeMinor,
  computePlatformFeeMinorFloor,
  currencyFromCountry2,
  normalizeCountry2
} from "@/lib/stripe";

function badRequest(reason: string, detail?: any) {
  return NextResponse.json({ status: "error", reason, detail }, { status: 400 });
}

function conflict(reason: string, detail?: any) {
  return NextResponse.json({ status: "error", reason, detail }, { status: 409 });
}

function isPayoutHoldActive(human: {
  payout_hold_status: string | null;
  payout_hold_until: string | null;
}) {
  if (human.payout_hold_status !== "active") return false;
  if (!human.payout_hold_until) return true;
  const until = Date.parse(human.payout_hold_until);
  if (!Number.isFinite(until)) return true;
  return until > Date.now();
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

    // Amount inputs are expressed in minor units for the chosen currency.
    // Back-compat: accept legacy *_jpy fields (treated as "minor units").
    const baseAmountMinor = assertNonNegativeInt(
      payload?.base_amount_minor ?? payload?.base_amount_jpy,
      "base_amount_minor"
    );
    const fxCostMinor =
      payload?.fx_cost_minor == null && payload?.fx_cost_jpy == null
        ? 0
        : assertNonNegativeInt(
            payload?.fx_cost_minor ?? payload?.fx_cost_jpy,
            "fx_cost_minor"
          );

    const db = getDb();
    const task = (await db.prepare(`SELECT * FROM tasks WHERE id = ? AND deleted_at IS NULL`).get(taskId)) as
      | { id: string; origin_country: string | null; human_id: string | null }
      | undefined;
    if (!task) return NextResponse.json({ status: "error", reason: "task_not_found" }, { status: 404 });
    if (!task.human_id) return conflict("missing_human");

    const human = (await db.prepare(`SELECT * FROM humans WHERE id = ? AND deleted_at IS NULL`).get(task.human_id)) as
      | {
          id: string;
          country: string | null;
          stripe_account_id: string | null;
          payout_hold_status: string | null;
          payout_hold_reason: string | null;
          payout_hold_until: string | null;
        }
      | undefined;
    if (!human) return conflict("missing_human");
    if (isPayoutHoldActive(human)) {
      return conflict("payout_hold_active", {
        human_id: human.id,
        reason: human.payout_hold_reason || "payout_hold_active",
        hold_until: human.payout_hold_until
      });
    }
    if (human.payout_hold_status === "active" && human.payout_hold_until) {
      const holdUntil = Date.parse(human.payout_hold_until);
      if (Number.isFinite(holdUntil) && holdUntil <= Date.now()) {
        await db
          .prepare(
            `UPDATE humans
             SET payout_hold_status = 'none',
                 payout_hold_reason = NULL,
                 payout_hold_until = NULL
             WHERE id = ?`
          )
          .run(human.id);
      }
    }

    const payerCountry = normalizeCountry2(task.origin_country);
    if (!payerCountry) return conflict("unsupported_payer_country", { origin_country: task.origin_country });
    const payeeCountry = normalizeCountry2(human.country);
    if (!payeeCountry) return conflict("unsupported_payee_country", { country: human.country });

    const destinationAccountId = (human.stripe_account_id || "").trim();
    if (!destinationAccountId.startsWith("acct_")) return conflict("missing_connect_account");

    const isInternational = computeIsInternational(payerCountry, payeeCountry);
    const currency = currencyFromCountry2(payeeCountry);

    // Surcharge policy:
    // - Applied only when payer_country != payee_country
    // - Added on top of (base + fx_cost) to cover cross-border fees + risk buffer
    // - Captured entirely by the platform (see checkout: application_fee_amount includes surcharge)
    const subtotalMinor = baseAmountMinor + fxCostMinor;
    const intlSurchargeMinor = computeIntlSurchargeMinor(
      subtotalMinor,
      currency,
      isInternational === 1
    );
    const totalAmountMinor = subtotalMinor + intlSurchargeMinor;

    // Platform fee is still 20% of subtotal (excluding surcharge), preserving worker economics.
    const platformFeeMinor = computePlatformFeeMinorFloor(subtotalMinor);

    const now = new Date().toISOString();
    const existing = (await db
      .prepare(`SELECT * FROM orders WHERE id = ? AND version = ?`)
      .get(orderId, version)) as any | undefined;

    const normalizedOrder = {
      id: orderId,
      version,
      payment_flow: "checkout",
      status: "created",
      currency,
      base_amount_jpy: baseAmountMinor,
      fx_cost_jpy: fxCostMinor,
      total_amount_jpy: totalAmountMinor,
      platform_fee_jpy: platformFeeMinor,
      intl_surcharge_minor: intlSurchargeMinor,
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
        "intl_surcharge_minor",
        "payer_country",
        "payee_country",
        "is_international",
        "destination_account_id",
        "human_id",
        "task_id"
      ]) {
        if (key === "intl_surcharge_minor") {
          const existingN = Number(existing[key] || 0);
          const requestedN = Number((normalizedOrder as any)[key] || 0);
          if (existingN !== requestedN) {
            mismatch[key] = { existing: existing[key], requested: (normalizedOrder as any)[key] };
          }
          continue;
        }
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
        intl_surcharge_minor,
        payer_country, payee_country, is_international, destination_account_id,
        human_id, task_id,
        checkout_session_id, payment_intent_id, charge_id, mismatch_reason, provider_error,
        created_at, updated_at
      ) VALUES (?, ?, 'checkout', 'created', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, ?, ?)`
    ).run(
      orderId,
      version,
      currency,
      baseAmountMinor,
      fxCostMinor,
      totalAmountMinor,
      platformFeeMinor,
      intlSurchargeMinor,
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
