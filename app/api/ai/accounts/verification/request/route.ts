import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { applyAiRateLimitHeaders, authenticateAiApiRequest } from "@/lib/ai-api-auth";
import {
  buildVerificationUrl,
  enqueueAiVerificationEmail,
  issueAiEmailVerificationToken,
  maskEmail
} from "@/lib/ai-email-verification";
import { validateAiOperatorEmailDomain } from "@/lib/ai-email-policy";

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: Request) {
  const payload: any = await request.json().catch(() => null);
  const aiAccountId = normalizeText(payload?.ai_account_id);
  const aiApiKey = normalizeText(payload?.ai_api_key);
  if (!aiAccountId || !aiApiKey) {
    return NextResponse.json({ status: "error", reason: "invalid_request" }, { status: 400 });
  }

  const auth = await authenticateAiApiRequest(aiAccountId, aiApiKey);
  if (auth.ok === false) return auth.response;

  const db = getDb();
  const account = await db
    .prepare(
      `SELECT id, paypal_email, email_verified_at
       FROM ai_accounts
       WHERE id = ? AND deleted_at IS NULL AND status = 'active'`
    )
    .get<{ id: string; paypal_email: string; email_verified_at: string | null }>(aiAccountId);
  if (!account?.id) {
    const response = NextResponse.json({ status: "error", reason: "invalid_credentials" }, { status: 401 });
    return applyAiRateLimitHeaders(response, auth);
  }
  if (account.email_verified_at) {
    const response = NextResponse.json({
      status: "already_verified",
      email_verified_at: account.email_verified_at
    });
    return applyAiRateLimitHeaders(response, auth);
  }

  const domainValidation = validateAiOperatorEmailDomain(account.paypal_email);
  const blockedReason = "reason" in domainValidation ? domainValidation.reason : null;
  if (blockedReason) {
    const response = NextResponse.json(
      {
        status: "error",
        reason: "invalid_email_domain",
        detail: blockedReason,
        domain: domainValidation.domain
      },
      { status: 400 }
    );
    return applyAiRateLimitHeaders(response, auth);
  }

  const issued = await issueAiEmailVerificationToken(db, {
    aiAccountId,
    email: account.paypal_email
  });
  const verificationUrl = buildVerificationUrl(request, aiAccountId, issued.token);
  await enqueueAiVerificationEmail(db, {
    aiAccountId,
    toEmail: account.paypal_email,
    verifyUrl: verificationUrl
  });

  const response = NextResponse.json({
    status: "verification_sent",
    sent_to: maskEmail(account.paypal_email),
    expires_at: issued.expiresAt
  });
  return applyAiRateLimitHeaders(response, auth);
}
