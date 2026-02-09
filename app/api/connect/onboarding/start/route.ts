import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getCurrentHumanIdByEmail } from "@/lib/human-session";
import {
  getStripePreferred,
  isStripePermissionError,
  normalizeCountry2,
  shouldPreferRestrictedKeyForServerOps
} from "@/lib/stripe";
import type Stripe from "stripe";

function getStringProp(obj: unknown, key: string): string | null {
  if (!obj || typeof obj !== "object") return null;
  const v = (obj as any)[key];
  return typeof v === "string" && v ? v : null;
}

export async function POST(request: Request) {
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

    const payload: any = await request.json().catch(() => ({}));
    const refreshUrl = typeof payload?.refresh_url === "string" ? payload.refresh_url.trim() : "";
    const returnUrl = typeof payload?.return_url === "string" ? payload.return_url.trim() : "";
    if (!refreshUrl || !returnUrl) {
      return NextResponse.json(
        { status: "error", reason: "missing_urls" },
        { status: 400 }
      );
    }

    const db = getDb();
    const human = await db
      .prepare(`SELECT * FROM humans WHERE id = ?`)
      .get<{ id: string; country: string | null; stripe_account_id: string | null }>(humanId);
    if (!human) {
      return NextResponse.json({ status: "error", reason: "missing_human" }, { status: 404 });
    }

    const country = normalizeCountry2(human.country);
    if (!country) {
      return NextResponse.json(
        { status: "error", reason: "unsupported_country" },
        { status: 409 }
      );
    }

    // Key policy: default to sk_. If STRIPE_PREFER_RESTRICTED_KEY=1, try rk_ first and fall back on permission errors.
    const preferRestricted = shouldPreferRestrictedKeyForServerOps();
    const { stripe, used, fallback } = getStripePreferred(preferRestricted);

    async function runWithFallback<T>(fn: (client: any) => Promise<T>): Promise<{ result: T; used: "sk" | "rk" }> {
      try {
        const result = await fn(stripe);
        return { result, used };
      } catch (err: any) {
        if (used === "rk" && fallback && isStripePermissionError(err)) {
          console.warn("stripe: restricted key lacks permission; falling back to sk_");
          const result = await fn(fallback);
          return { result, used: "sk" };
        }
        throw err;
      }
    }

    let accountId = human.stripe_account_id;
    if (!accountId) {
      const created = await runWithFallback<Stripe.Account>((client) =>
        client.accounts.create({
          type: "express",
          country,
          // For Express, request transfers capability so payouts/receiving works.
          capabilities: { transfers: { requested: true } }
        })
      );
      // Some build environments can end up treating SDK results as `unknown`.
      // Pull out the id defensively to keep type-checking and runtime aligned.
      const createdId = getStringProp(created.result, "id");
      if (!createdId) {
        return NextResponse.json(
          { status: "error", reason: "stripe_error", message: "stripe_account_missing_id" },
          { status: 502 }
        );
      }
      accountId = createdId;
      await db
        .prepare(`UPDATE humans SET stripe_account_id = ? WHERE id = ?`)
        .run(accountId, humanId);
    }

    const link = await runWithFallback<Stripe.AccountLink>((client) =>
      client.accountLinks.create({
        account: accountId,
        refresh_url: refreshUrl,
        return_url: returnUrl,
        type: "account_onboarding"
      })
    );
    const onboardingUrl = getStringProp(link.result, "url");
    if (!onboardingUrl) {
      return NextResponse.json(
        { status: "error", reason: "stripe_error", message: "stripe_account_link_missing_url" },
        { status: 502 }
      );
    }

    return NextResponse.json({
      status: "ok",
      human_id: humanId,
      stripe_account_id: accountId,
      onboarding_url: onboardingUrl
    });
  } catch (err: any) {
    console.error("POST /api/connect/onboarding/start failed", err);
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
