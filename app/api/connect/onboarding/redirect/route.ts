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

function getAppBaseUrl() {
  const base = (process.env.APP_BASE_URL || "").trim().replace(/\/+$/, "");
  if (!base) throw new Error("Missing APP_BASE_URL");
  return base;
}

function toErrorRedirect(base: string, lang: string, reason: string) {
  const url = new URL(`${base}/me`);
  url.searchParams.set("lang", lang === "ja" ? "ja" : "en");
  url.searchParams.set("tab", "payments");
  url.searchParams.set("connect_error", reason);
  return url.toString();
}

export async function GET(request: Request) {
  const reqUrl = new URL(request.url);
  const lang = reqUrl.searchParams.get("lang") === "ja" ? "ja" : "en";
  const base = getAppBaseUrl();
  const refreshUrl = `${base}/me?lang=${lang}&tab=payments`;
  const returnUrl = `${base}/me?lang=${lang}&tab=payments`;

  try {
    const session = await getServerSession(authOptions);
    const email = session?.user?.email;
    if (!email) {
      return NextResponse.redirect(`${base}/auth?lang=${lang}`, { status: 303 });
    }

    const humanId = await getCurrentHumanIdByEmail(email);
    if (!humanId) {
      return NextResponse.redirect(toErrorRedirect(base, lang, "missing_human"), { status: 303 });
    }

    const db = getDb();
    const human = await db
      .prepare(`SELECT * FROM humans WHERE id = ? AND deleted_at IS NULL`)
      .get<{ id: string; country: string | null; stripe_account_id: string | null }>(humanId);
    if (!human) {
      return NextResponse.redirect(toErrorRedirect(base, lang, "missing_human"), { status: 303 });
    }

    const country = normalizeCountry2(human.country);
    if (!country) {
      return NextResponse.redirect(toErrorRedirect(base, lang, "unsupported_country"), { status: 303 });
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

    let accountId = human.stripe_account_id;
    if (!accountId) {
      const created = await runWithFallback<Stripe.Account>((client) =>
        client.accounts.create({
          type: "express",
          country,
          capabilities: { transfers: { requested: true } }
        })
      );
      const createdId = getStringProp(created, "id");
      if (!createdId) {
        return NextResponse.redirect(toErrorRedirect(base, lang, "stripe_account_missing_id"), { status: 303 });
      }
      accountId = createdId;
      await db.prepare(`UPDATE humans SET stripe_account_id = ? WHERE id = ?`).run(accountId, humanId);
    }

    const link = await runWithFallback<Stripe.AccountLink>((client) =>
      client.accountLinks.create({
        account: accountId,
        refresh_url: refreshUrl,
        return_url: returnUrl,
        type: "account_onboarding"
      })
    );
    const onboardingUrl = getStringProp(link, "url");
    if (!onboardingUrl) {
      return NextResponse.redirect(toErrorRedirect(base, lang, "stripe_account_link_missing_url"), { status: 303 });
    }

    return NextResponse.redirect(onboardingUrl, { status: 303 });
  } catch (err: any) {
    console.error("GET /api/connect/onboarding/redirect failed", err);
    const reason =
      err?.type?.startsWith?.("Stripe")
        ? (err?.message || "stripe_error")
        : "internal_error";
    return NextResponse.redirect(toErrorRedirect(base, lang, reason), { status: 303 });
  }
}
