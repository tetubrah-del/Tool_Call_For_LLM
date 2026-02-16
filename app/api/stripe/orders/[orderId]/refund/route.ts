import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";
import {
  assertNonNegativeInt,
  buildIdempotencyKey,
  getStripePreferred,
  isStripePermissionError,
  shouldPreferRestrictedKeyForServerOps
} from "@/lib/stripe";
import type Stripe from "stripe";

function badRequest(reason: string, detail?: any) {
  return NextResponse.json({ status: "error", reason, detail }, { status: 400 });
}

function conflict(reason: string, detail?: any) {
  return NextResponse.json({ status: "error", reason, detail }, { status: 409 });
}

type RefundReason = "duplicate" | "fraudulent" | "requested_by_customer";

function parseRefundReason(value: unknown): RefundReason | null {
  if (value === "duplicate") return "duplicate";
  if (value === "fraudulent") return "fraudulent";
  if (value === "requested_by_customer") return "requested_by_customer";
  return null;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ orderId: string }> }
) {
  const { orderId } = await context.params;
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const payload: any = await request.json().catch(() => ({}));
    const version = payload?.version == null ? 1 : Number(payload.version);
    if (!Number.isInteger(version) || version <= 0) {
      return badRequest("invalid_version");
    }

    const reason = parseRefundReason(payload?.reason);
    if (payload?.reason != null && !reason) {
      return badRequest("invalid_refund_reason");
    }

    const db = getDb();
    const order = await db
      .prepare(`SELECT * FROM orders WHERE id = ? AND version = ?`)
      .get<any>(orderId, version);
    if (!order) {
      return NextResponse.json({ status: "not_found" }, { status: 404 });
    }

    if (
      order.status !== "paid" &&
      order.status !== "partially_refunded"
    ) {
      return conflict("invalid_order_status", { status: order.status });
    }

    const totalAmountMinor = Number(order.total_amount_jpy);
    if (!Number.isInteger(totalAmountMinor) || totalAmountMinor <= 0) {
      return conflict("invalid_total_amount");
    }
    const refundedSoFar = Number(order.refund_amount_minor || 0);
    if (!Number.isInteger(refundedSoFar) || refundedSoFar < 0) {
      return conflict("invalid_refund_state");
    }
    const remaining = totalAmountMinor - refundedSoFar;
    if (remaining <= 0) {
      return conflict("already_fully_refunded");
    }

    const requestedAmount =
      payload?.amount_minor == null
        ? remaining
        : assertNonNegativeInt(payload.amount_minor, "amount_minor");
    if (!Number.isInteger(requestedAmount) || requestedAmount <= 0) {
      return badRequest("invalid_refund_amount");
    }
    if (requestedAmount > remaining) {
      return conflict("refund_amount_exceeds_remaining", {
        requested: requestedAmount,
        remaining
      });
    }

    const paymentIntentId = String(order.payment_intent_id || "").trim();
    const chargeId = String(order.charge_id || "").trim();
    if (!paymentIntentId && !chargeId) {
      return conflict("missing_payment_reference");
    }

    const preferRestricted = shouldPreferRestrictedKeyForServerOps();
    const { stripe, used, fallback } = getStripePreferred(preferRestricted);
    async function runWithFallback<T>(fn: (client: Stripe) => Promise<T>): Promise<T> {
      try {
        return await fn(stripe);
      } catch (err: any) {
        if (used === "rk" && fallback && isStripePermissionError(err)) {
          return await fn(fallback);
        }
        throw err;
      }
    }

    const idemKey = buildIdempotencyKey("order_refund_create", orderId, version);
    const refund = await runWithFallback((client) =>
      client.refunds.create(
        {
          amount: requestedAmount,
          reason: reason || undefined,
          payment_intent: paymentIntentId || undefined,
          charge: paymentIntentId ? undefined : chargeId || undefined,
          metadata: {
            order_id: orderId,
            version: String(version)
          }
        },
        { idempotencyKey: `${idemKey}:${requestedAmount}` }
      )
    );

    const now = new Date().toISOString();
    const refundStatus = String(refund.status || "");
    const succeeded = refundStatus === "succeeded";
    const failed = refundStatus === "failed" || refundStatus === "canceled";
    const nextRefundAmount = succeeded ? refundedSoFar + requestedAmount : refundedSoFar;
    const isFull = succeeded && nextRefundAmount >= totalAmountMinor;
    const nextOrderStatus = succeeded
      ? (isFull ? "refunded" : "partially_refunded")
      : order.status;
    const nextRefundState = succeeded
      ? (isFull ? "full" : "partial")
      : failed
        ? "failed"
        : "pending";

    await db.prepare(
      `UPDATE orders
       SET status = ?,
           refund_status = ?,
           refund_amount_minor = ?,
           refund_reason = ?,
           refund_id = ?,
           refunded_at = ?,
           refund_error_message = ?,
           updated_at = ?
       WHERE id = ? AND version = ?`
    ).run(
      nextOrderStatus,
      nextRefundState,
      nextRefundAmount,
      reason || null,
      refund.id,
      succeeded ? now : null,
      failed ? "refund_failed" : null,
      now,
      orderId,
      version
    );

    const updatedOrder = await db
      .prepare(`SELECT * FROM orders WHERE id = ? AND version = ?`)
      .get(orderId, version);

    return NextResponse.json({
      status: "ok",
      refund: {
        id: refund.id,
        stripe_status: refund.status,
        amount_minor: refund.amount,
        reason: refund.reason || null
      },
      order: updatedOrder
    });
  } catch (err: any) {
    console.error("POST /api/stripe/orders/:orderId/refund failed", err);
    if (err?.type?.startsWith?.("Stripe")) {
      return NextResponse.json(
        { status: "error", reason: "stripe_error", message: err.message ?? "stripe_error" },
        { status: 502 }
      );
    }
    const status = err?.statusCode && Number.isInteger(err.statusCode) ? err.statusCode : 500;
    return NextResponse.json(
      { status: "error", reason: status === 400 ? "invalid_request" : "internal_error" },
      { status }
    );
  }
}
