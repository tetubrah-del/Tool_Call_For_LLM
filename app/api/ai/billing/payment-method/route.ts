import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { applyAiRateLimitHeaders, authenticateAiApiRequest } from "@/lib/ai-api-auth";
import { setDefaultPaymentMethodForAi } from "@/lib/ai-billing";

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: Request) {
  const payload: any = await request.json().catch(() => null);
  const aiAccountId = normalizeText(payload?.ai_account_id);
  const aiApiKey = normalizeText(payload?.ai_api_key);
  const paymentMethodId = normalizeText(payload?.payment_method_id);
  if (!aiAccountId || !aiApiKey || !paymentMethodId) {
    return NextResponse.json({ status: "error", reason: "invalid_request" }, { status: 400 });
  }

  const auth = await authenticateAiApiRequest(aiAccountId, aiApiKey);
  if (auth.ok === false) return auth.response;

  const db = getDb();
  const result = await setDefaultPaymentMethodForAi(db, aiAccountId, paymentMethodId);
  if (result.ok === false) {
    const status =
      result.reason === "ai_not_found"
        ? 404
        : result.reason === "billing_not_ready"
          ? 409
          : result.reason === "stripe_error"
            ? 502
            : 500;
    const response = NextResponse.json(
      { status: "error", reason: result.reason, message: result.message || null },
      { status }
    );
    return applyAiRateLimitHeaders(response, auth);
  }

  const response = NextResponse.json({
    status: "ok",
    stripe_customer_id: result.value.stripe_customer_id,
    default_payment_method_id: result.value.default_payment_method_id
  });
  return applyAiRateLimitHeaders(response, auth);
}
