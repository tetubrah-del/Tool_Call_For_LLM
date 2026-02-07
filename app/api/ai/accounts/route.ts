import crypto from "crypto";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { normalizePaypalEmail } from "@/lib/paypal";

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

  const db = getDb();
  const existing = db
    .prepare(`SELECT * FROM ai_accounts WHERE paypal_email = ? ORDER BY created_at DESC LIMIT 1`)
    .get(paypalEmail) as
    | { id: string; api_key: string; status: "active" | "disabled" }
    | undefined;

  if (existing?.id) {
    if (existing.status !== "active") {
      return NextResponse.json(
        { status: "error", reason: "account_disabled" },
        { status: 400 }
      );
    }

    db.prepare(`UPDATE ai_accounts SET name = ? WHERE id = ?`).run(name, existing.id);
    return NextResponse.json({
      status: "connected",
      account_id: existing.id,
      api_key: existing.api_key
    });
  }

  const id = crypto.randomUUID();
  const apiKey = crypto.randomBytes(24).toString("hex");
  const createdAt = new Date().toISOString();

  db.prepare(
    `INSERT INTO ai_accounts (id, name, paypal_email, api_key, status, created_at)
     VALUES (?, ?, ?, ?, 'active', ?)`
  ).run(id, name, paypalEmail, apiKey, createdAt);

  return NextResponse.json({
    status: "connected",
    account_id: id,
    api_key: apiKey
  });
}

export async function GET(request: Request) {
  const db = getDb();
  const url = new URL(request.url);
  const accountId = url.searchParams.get("account_id");
  const apiKey = url.searchParams.get("api_key");

  if (!accountId || !apiKey) {
    return NextResponse.json(
      { status: "error", reason: "invalid_request" },
      { status: 400 }
    );
  }

  const account = db
    .prepare(`SELECT * FROM ai_accounts WHERE id = ?`)
    .get(accountId) as
    | { id: string; name: string; paypal_email: string; api_key: string; status: string }
    | undefined;

  if (!account || account.api_key !== apiKey || account.status !== "active") {
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
      status: account.status
    }
  });
}
