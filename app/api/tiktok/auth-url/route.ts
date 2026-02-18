import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { buildAuthorizeUrl, isTikTokMarketingEnabled, readTikTokAuthConfig } from "@/lib/tiktok-auth";

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

  const { url } = buildAuthorizeUrl(config);
  return NextResponse.json({ status: "ok", authorize_url: url });
}
