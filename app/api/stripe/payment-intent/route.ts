import { NextResponse } from "next/server";

// MVP policy: Stripe Checkout only.
// PaymentIntent direct creation is intentionally disabled to prevent mixed flows.
export async function POST() {
  return NextResponse.json(
    { status: "error", reason: "payment_intent_flow_disabled", payment_flow: "checkout" },
    { status: 410 }
  );
}

