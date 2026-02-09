import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getDb } from "@/lib/db";
import { getStripeClients } from "@/lib/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function requireEnv(name: string) {
  const v = (process.env[name] || "").trim();
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

function safeJson(value: any) {
  try {
    return JSON.stringify(value);
  } catch {
    return "{}";
  }
}

// Webhook must always return 200 quickly. We still verify signature and only persist valid events.
export async function POST(request: Request) {
  const receivedAt = new Date().toISOString();

  // Always return 200; process work in-line but keep bounded.
  // If verification fails, we log and return 200 without storing.
  try {
    const secret = requireEnv("STRIPE_WEBHOOK_SECRET");
    const sig = request.headers.get("stripe-signature") || "";
    const raw = Buffer.from(await request.arrayBuffer());

    const { sk } = getStripeClients();
    let event: Stripe.Event;
    try {
      event = sk.webhooks.constructEvent(raw, sig, secret) as Stripe.Event;
    } catch (err: any) {
      console.error("stripe webhook: signature verification failed", {
        received_at: receivedAt,
        message: err?.message || String(err || "")
      });
      return NextResponse.json({ received: true }, { status: 200 });
    }

    // Required common logging
    console.log("stripe webhook event", {
      event_id: event.id,
      type: event.type,
      created: event.created,
      object: (event.data as any)?.object
        ? (event.data as any).object.object
        : null
    });

    const db = getDb();
    const payloadJson = safeJson(event);

    // DB-backed dedupe: event_id primary key + ON CONFLICT DO NOTHING.
    await db
      .prepare(
        `INSERT INTO stripe_webhook_events (
          event_id,
          event_type,
          event_created,
          payload_json,
          received_at,
          status
        ) VALUES (?, ?, ?, ?, ?, 'pending')
        ON CONFLICT(event_id) DO NOTHING`
      )
      .run(event.id, event.type, event.created, payloadJson, receivedAt);

    return NextResponse.json({ received: true }, { status: 200 });
  } catch (err) {
    console.error("POST /webhooks/stripe failed", err);
    return NextResponse.json({ received: true }, { status: 200 });
  }
}

