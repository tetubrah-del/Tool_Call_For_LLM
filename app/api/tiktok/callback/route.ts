import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import {
  exchangeCodeForToken,
  isTikTokMarketingEnabled,
  readTikTokAuthConfig,
  verifyOAuthState
} from "@/lib/tiktok-auth";

function toSafeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function GET(request: Request) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  if (!isTikTokMarketingEnabled()) {
    return NextResponse.json({ status: "error", reason: "tiktok_disabled" }, { status: 404 });
  }

  const config = readTikTokAuthConfig();
  if (!config) {
    return NextResponse.json(
      { status: "error", reason: "tiktok_not_configured" },
      { status: 503 }
    );
  }

  const url = new URL(request.url);
  const code = toSafeText(url.searchParams.get("code"));
  const state = toSafeText(url.searchParams.get("state"));
  const error = toSafeText(url.searchParams.get("error"));
  const errorDescription = toSafeText(url.searchParams.get("error_description"));

  const redirect = new URL("/manage/tiktok", url.origin);
  if (error) {
    redirect.searchParams.set("status", "error");
    redirect.searchParams.set("reason", errorDescription || error);
    return NextResponse.redirect(redirect, { status: 302 });
  }

  if (!code || !state || !verifyOAuthState(state, config.stateSecret)) {
    redirect.searchParams.set("status", "error");
    redirect.searchParams.set("reason", "invalid_callback_state_or_code");
    return NextResponse.redirect(redirect, { status: 302 });
  }

  try {
    const token = await exchangeCodeForToken(config, code);
    redirect.searchParams.set("status", "ok");
    redirect.searchParams.set("open_id", toSafeText(token.open_id || ""));
    redirect.searchParams.set("expires_in", String(Number(token.expires_in) || 0));
    redirect.searchParams.set("scope", toSafeText(token.scope || ""));
    return NextResponse.redirect(redirect, { status: 302 });
  } catch (err: any) {
    redirect.searchParams.set("status", "error");
    redirect.searchParams.set("reason", toSafeText(err?.message || "token_exchange_failed"));
    return NextResponse.redirect(redirect, { status: 302 });
  }
}
