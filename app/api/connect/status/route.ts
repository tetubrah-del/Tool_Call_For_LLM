import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getCurrentHumanIdByEmail } from "@/lib/human-session";
import {
  ensureDestinationChargePreconditions,
  getStripePreferred,
  isStripePermissionError,
  normalizeCountry2,
  retrieveConnectedAccountOrThrow,
  shouldPreferRestrictedKeyForServerOps
} from "@/lib/stripe";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    const email = session?.user?.email;
    if (!email) {
      return NextResponse.json({ status: "unauthorized" }, { status: 401 });
    }

    const humanId = await getCurrentHumanIdByEmail(email);
    if (!humanId) {
      return NextResponse.json({ status: "error", reason: "missing_human" }, { status: 404 });
    }

    const db = getDb();
    const human = await db
      .prepare(`SELECT * FROM humans WHERE id = ? AND deleted_at IS NULL`)
      .get<{ id: string; country: string | null; stripe_account_id: string | null }>(humanId);
    if (!human) {
      return NextResponse.json({ status: "error", reason: "missing_human" }, { status: 404 });
    }

    const accountId = human.stripe_account_id;
    if (!accountId) {
      return NextResponse.json({
        status: "ok",
        human_id: humanId,
        stripe_account_id: null,
        connect_ready: false,
        reason: "not_connected"
      });
    }

    const country = normalizeCountry2(human.country);
    if (!country) {
      return NextResponse.json(
        { status: "error", reason: "unsupported_country" },
        { status: 409 }
      );
    }

    const preferRestricted = shouldPreferRestrictedKeyForServerOps();
    const { stripe, used, fallback } = getStripePreferred(preferRestricted);

    async function retrieve(client: any) {
      return retrieveConnectedAccountOrThrow(client, accountId);
    }

    let account: any;
    try {
      account = await retrieve(stripe);
    } catch (err: any) {
      if (used === "rk" && fallback && isStripePermissionError(err)) {
        console.warn("stripe: restricted key lacks permission; falling back to sk_");
        account = await retrieve(fallback);
      } else {
        throw err;
      }
    }

    let connectReady = true;
    let reason: string | null = null;
    try {
      ensureDestinationChargePreconditions(account, country);
    } catch (err: any) {
      connectReady = false;
      reason = err?.message || "not_ready";
    }

    return NextResponse.json({
      status: "ok",
      human_id: humanId,
      stripe_account_id: accountId,
      connect_ready: connectReady,
      reason,
      account: {
        id: account.id,
        country: account.country,
        charges_enabled: account.charges_enabled,
        payouts_enabled: account.payouts_enabled,
        requirements: account.requirements,
        capabilities: account.capabilities
      }
    });
  } catch (err: any) {
    console.error("GET /api/connect/status failed", err);
    if (err?.type?.startsWith?.("Stripe")) {
      return NextResponse.json(
        { status: "error", reason: "stripe_error", message: err.message ?? "stripe_error" },
        { status: 502 }
      );
    }
    return NextResponse.json(
      { status: "error", reason: "internal_error" },
      { status: 500 }
    );
  }
}
