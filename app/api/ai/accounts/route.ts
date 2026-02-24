import crypto from "crypto";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { normalizePaypalEmail } from "@/lib/paypal";
import { validateAiOperatorEmailDomain } from "@/lib/ai-email-policy";
import {
  authenticateAiApiRequest,
  generateAiApiKey,
  hashAiApiKey,
  parseAiApiKeyFromRequest
} from "@/lib/ai-api-auth";

export async function POST(request: Request) {
  let payload: any = null;
  try {
    payload = await request.json();
  } catch {
    payload = null;
  }

  const name = typeof payload?.name === "string" ? payload.name.trim() : "";
  const paypalEmail = normalizePaypalEmail(payload?.paypal_email);

  if (!name || !paypalEmail) {
    return NextResponse.json(
      { status: "error", reason: "invalid_request" },
      { status: 400 }
    );
  }
  const domainValidation = validateAiOperatorEmailDomain(paypalEmail);
  const blockedReason = "reason" in domainValidation ? domainValidation.reason : null;
  if (blockedReason) {
    return NextResponse.json(
      {
        status: "error",
        reason: "invalid_email_domain",
        detail: blockedReason,
        domain: domainValidation.domain
      },
      { status: 400 }
    );
  }

  const db = getDb();
  const existing = await db
    .prepare(
      `SELECT * FROM ai_accounts WHERE paypal_email = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1`
    )
    .get(paypalEmail) as
    | { id: string; status: "active" | "disabled"; email_verified_at?: string | null }
    | undefined;

  if (existing?.id) {
    if (existing.status !== "active") {
      return NextResponse.json(
        { status: "error", reason: "account_disabled" },
        { status: 400 }
      );
    }

    await db.prepare(`UPDATE ai_accounts SET name = ? WHERE id = ?`).run(name, existing.id);
    return NextResponse.json({
      status: "already_connected",
      account_id: existing.id,
      email_verified: Boolean(existing.email_verified_at),
      email_verified_at: existing.email_verified_at || null
    });
  }

  const id = crypto.randomUUID();
  const generated = generateAiApiKey();
  const apiKeyHash = hashAiApiKey(generated.key);
  const createdAt = new Date().toISOString();

  await db.prepare(
    `INSERT INTO ai_accounts (id, name, paypal_email, api_key, api_key_hash, api_key_prefix, email_verified_at, status, created_at)
     VALUES (?, ?, ?, '', ?, ?, NULL, 'active', ?)`
  ).run(id, name, paypalEmail, apiKeyHash, generated.prefix, createdAt);

  return NextResponse.json({
    status: "connected",
    account_id: id,
    api_key: generated.key,
    email_verified: false,
    email_verified_at: null
  });
}

export async function GET(request: Request) {
  const db = getDb();
  const url = new URL(request.url);
  const accountId = (url.searchParams.get("account_id") || "").trim();
  const apiKey = parseAiApiKeyFromRequest(request);

  if (!accountId || !apiKey) {
    return NextResponse.json(
      { status: "error", reason: "invalid_request" },
      { status: 400 }
    );
  }

  const auth = await authenticateAiApiRequest(accountId, apiKey);
  if (auth.ok === false) return auth.response;

  const account = await db
    .prepare(`SELECT * FROM ai_accounts WHERE id = ? AND deleted_at IS NULL`)
    .get(accountId) as
    | {
        id: string;
        name: string;
        paypal_email: string;
        status: string;
        email_verified_at?: string | null;
      }
    | undefined;

  if (!account || account.status !== "active") {
    return NextResponse.json(
      { status: "error", reason: "invalid_credentials" },
      { status: 401 }
    );
  }

  return NextResponse.json({
    account: {
      id: account.id,
      name: account.name,
      paypal_email: account.paypal_email,
      status: account.status,
      email_verified: Boolean(account.email_verified_at),
      email_verified_at: account.email_verified_at || null
    }
  });
}
