import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { applyAiRateLimitHeaders, authenticateAiApiRequest, type AiAuthSuccess } from "@/lib/ai-api-auth";
import {
  buildIdempotencyKey,
  ensureDestinationChargePreconditions,
  getStripePreferred,
  isStripePermissionError,
  retrieveConnectedAccountOrThrow,
  shouldPreferRestrictedKeyForServerOps
} from "@/lib/stripe";
import type Stripe from "stripe";

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
  const auth = await authenticateAiApiRequest(aiAccountId, aiApiKey);
  if (auth.ok === false) return { ok: false as const, response: auth.response };
  return { ok: true as const, aiAccountId, aiAuth: auth };
}

function requireAppBaseUrl() {
  const base = (process.env.APP_BASE_URL || "").trim().replace(/\/+$/, "");
  if (!base) throw new Error("Missing APP_BASE_URL");
  return base;
}

function validateRedirectUrl(base: string, value: string, field: string) {
  const url = value.trim();
  if (!url) {
    const err = new Error(`${field} is required`);
    (err as any).statusCode = 400;
    throw err;
  }
  if (!url.startsWith(base)) {
    const err = new Error(`${field} must start with APP_BASE_URL`);
    (err as any).statusCode = 400;
    throw err;
  }
  return url;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ orderId: string }> }
) {
  const { orderId } = await context.params;
  try {
    const payload: any = await request.json().catch(() => ({}));
    let aiAuth: AiAuthSuccess | null = null;

    const auth = await requireAiCredentials(payload);
    if (auth.ok === false) return auth.response;
    aiAuth = auth.aiAuth;

    const url = new URL(request.url);
    const version = payload?.version ?? url.searchParams.get("version") ?? 1;
    const v = Number(version);
    if (!Number.isInteger(v) || v <= 0) return badRequest("invalid_version");

    const db = getDb();
    const order = (await db
      .prepare(`SELECT * FROM orders WHERE id = ? AND version = ?`)
      .get(orderId, v)) as any | undefined;
    if (!order) return NextResponse.json({ status: "not_found" }, { status: 404 });
    if (order.payment_flow !== "checkout") return conflict("invalid_payment_flow");
    if (order.human_id) {
      const human = (await db
        .prepare(
          `SELECT id, payout_hold_status, payout_hold_reason, payout_hold_until
           FROM humans
           WHERE id = ? AND deleted_at IS NULL`
        )
        .get(order.human_id)) as
        | {
            id: string;
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
    }

    // Strict state machine: allow checkout creation only from 'created'.
    if (order.status !== "created") {
      return conflict("invalid_order_status", { status: order.status });
    }

    if (order.checkout_session_id) {
      return conflict("checkout_already_created", { checkout_session_id: order.checkout_session_id });
    }

    const base = requireAppBaseUrl();
    const successUrl = validateRedirectUrl(
      base,
      typeof payload?.success_url === "string"
        ? payload.success_url
        : `${base}/for-agents?status=success`,
      "success_url"
    );
    const cancelUrl = validateRedirectUrl(
      base,
      typeof payload?.cancel_url === "string"
        ? payload.cancel_url
        : `${base}/for-agents?status=cancel`,
      "cancel_url"
    );

    const warningMessage =
      Number(order.is_international) === 1
        ? "国が異なる取引のため、追加コストが発生する可能性があります"
        : null;

    const currency = String(order.currency || "").trim().toLowerCase();
    if (currency !== "jpy" && currency !== "usd") return conflict("unsupported_currency", { currency });

    const intlSurchargeMinor = Number(order.intl_surcharge_minor || 0);
    if (!Number.isInteger(intlSurchargeMinor) || intlSurchargeMinor < 0) {
      return badRequest("invalid_intl_surcharge", { intl_surcharge_minor: order.intl_surcharge_minor });
    }

    // Total is stored in legacy column name; value represents minor units for `order.currency`.
    const totalAmountMinor = Number(order.total_amount_jpy);
    const platformFeeMinor = Number(order.platform_fee_jpy);
    if (!Number.isInteger(totalAmountMinor) || totalAmountMinor <= 0) return badRequest("invalid_total_amount");
    if (!Number.isInteger(platformFeeMinor) || platformFeeMinor < 0) return badRequest("invalid_platform_fee");

    // Platform captures surcharge entirely to cover cross-border costs.
    const applicationFeeMinor = platformFeeMinor + intlSurchargeMinor;
    if (applicationFeeMinor > totalAmountMinor) {
      return badRequest("invalid_application_fee", { application_fee_amount: applicationFeeMinor, total_amount: totalAmountMinor });
    }

    const preferRestricted = shouldPreferRestrictedKeyForServerOps();
    const { stripe, used, fallback } = getStripePreferred(preferRestricted);

    async function runWithFallback<T>(fn: (client: any) => Promise<T>): Promise<T> {
      try {
        return await fn(stripe);
      } catch (err: any) {
        if (used === "rk" && fallback && isStripePermissionError(err)) {
          console.warn("stripe: restricted key lacks permission; falling back to sk_");
          return await fn(fallback);
        }
        throw err;
      }
    }

    // Preconditions check: connected account country & transfers capability.
    const connected = await runWithFallback((client) =>
      retrieveConnectedAccountOrThrow(client, String(order.destination_account_id))
    );
    ensureDestinationChargePreconditions(connected as any, order.payee_country);

    const idemKey = buildIdempotencyKey("checkout_session_create", orderId, v);
    const now = new Date().toISOString();

    const session = await runWithFallback<Stripe.Checkout.Session>((client) =>
      client.checkout.sessions.create(
        {
          mode: "payment",
          currency,
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency,
                unit_amount: totalAmountMinor,
                product_data: {
                  name: "Order payment"
                }
              }
            }
          ],
          success_url: successUrl,
          cancel_url: cancelUrl,
          // Required linkage: client_reference_id and metadata must both exist and match.
          client_reference_id: `${orderId}:v${v}`,
          // Metadata is supplemental; DB is source-of-truth.
          metadata: {
            order_id: String(orderId),
            version: String(v)
          },
          payment_intent_data: {
            application_fee_amount: applicationFeeMinor,
            transfer_data: {
              destination: String(order.destination_account_id)
            },
            metadata: {
              order_id: String(orderId),
              version: String(v)
            }
          }
        },
        { idempotencyKey: idemKey }
      )
    );

    await db.prepare(
      `UPDATE orders
       SET status = 'checkout_created',
           checkout_session_id = ?,
           updated_at = ?
       WHERE id = ? AND version = ?`
    ).run(session.id, now, orderId, v);

    let response: NextResponse = NextResponse.json({
      status: "ok",
      order_id: orderId,
      version: v,
      checkout_session_id: session.id,
      checkout_url: session.url,
      warning_message: warningMessage
    });
    if (aiAuth) response = applyAiRateLimitHeaders(response, aiAuth);
    return response;
  } catch (err: any) {
    console.error("POST /api/stripe/orders/:orderId/checkout failed", err);
    const status = err?.statusCode && Number.isInteger(err.statusCode) ? err.statusCode : 500;
    if (err?.type?.startsWith?.("Stripe")) {
      return NextResponse.json(
        { status: "error", reason: "stripe_error", message: err.message ?? "stripe_error" },
        { status: 502 }
      );
    }
    return NextResponse.json(
      { status: "error", reason: status === 400 ? "invalid_request" : "internal_error" },
      { status }
    );
  }
}
