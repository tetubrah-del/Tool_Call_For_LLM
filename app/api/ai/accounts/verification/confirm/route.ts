import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAiEmailToken } from "@/lib/ai-email-verification";

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const aiAccountId = normalizeText(url.searchParams.get("ai_account_id"));
  const token = normalizeText(url.searchParams.get("token"));
  if (!aiAccountId || !token) {
    return NextResponse.json({ status: "error", reason: "invalid_request" }, { status: 400 });
  }

  const db = getDb();
  const result = await verifyAiEmailToken(db, { aiAccountId, token });
  if (!result.ok) {
    const failureReason = "reason" in result ? result.reason : "invalid_token";
    const status = failureReason === "account_not_found" ? 404 : 400;
    return NextResponse.json({ status: "error", reason: failureReason }, { status });
  }

  return NextResponse.json({
    status: "verified",
    ai_account_id: aiAccountId,
    email_verified_at: result.verifiedAt
  });
}
