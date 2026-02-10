import crypto from "crypto";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { generateWebhookSecret, type WebhookEventType } from "@/lib/webhooks";

const ALLOWED_EVENTS: WebhookEventType[] = [
  "task.accepted",
  "task.completed",
  "task.failed"
];

function parseEvents(value: unknown): WebhookEventType[] | null {
  if (value == null) return [...ALLOWED_EVENTS];
  if (!Array.isArray(value)) return null;
  const normalized = value.filter((event): event is WebhookEventType =>
    typeof event === "string" && ALLOWED_EVENTS.includes(event as WebhookEventType)
  );
  if (normalized.length === 0) return null;
  return Array.from(new Set(normalized));
}

function isValidWebhookUrl(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

async function loadAiAccount(db: ReturnType<typeof getDb>, aiAccountId: string, aiApiKey: string) {
  const aiAccount = await db
    .prepare(`SELECT * FROM ai_accounts WHERE id = ? AND deleted_at IS NULL`)
    .get(aiAccountId) as
    | { id: string; api_key: string; status: string }
    | undefined;

  if (!aiAccount || aiAccount.api_key !== aiApiKey || aiAccount.status !== "active") {
    return null;
  }
  return aiAccount;
}

export async function POST(request: Request) {
  const payload: any = await request.json().catch(() => ({}));
  const aiAccountId =
    typeof payload?.ai_account_id === "string" ? payload.ai_account_id.trim() : "";
  const aiApiKey = typeof payload?.ai_api_key === "string" ? payload.ai_api_key.trim() : "";
  const url = typeof payload?.url === "string" ? payload.url.trim() : "";
  const events = parseEvents(payload?.events);

  if (!aiAccountId || !aiApiKey || !url || !events || !isValidWebhookUrl(url)) {
    return NextResponse.json({ status: "error", reason: "invalid_request" }, { status: 400 });
  }

  const db = getDb();
  const account = await loadAiAccount(db, aiAccountId, aiApiKey);
  if (!account) {
    return NextResponse.json({ status: "error", reason: "invalid_credentials" }, { status: 401 });
  }

  const id = crypto.randomUUID();
  const secret = generateWebhookSecret();
  const createdAt = new Date().toISOString();

  await db.prepare(
    `INSERT INTO webhook_endpoints (id, ai_account_id, url, secret, status, events, created_at)
     VALUES (?, ?, ?, ?, 'active', ?, ?)`
  ).run(id, aiAccountId, url, secret, events.join(","), createdAt);

  return NextResponse.json({
    status: "created",
    webhook: {
      id,
      url,
      status: "active",
      events,
      secret,
      created_at: createdAt
    }
  });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const aiAccountId = (url.searchParams.get("ai_account_id") || "").trim();
  const aiApiKey = (url.searchParams.get("ai_api_key") || "").trim();

  if (!aiAccountId || !aiApiKey) {
    return NextResponse.json({ status: "error", reason: "invalid_request" }, { status: 400 });
  }

  const db = getDb();
  const account = await loadAiAccount(db, aiAccountId, aiApiKey);
  if (!account) {
    return NextResponse.json({ status: "error", reason: "invalid_credentials" }, { status: 401 });
  }

  const webhooks = await db
    .prepare(
      `SELECT id, url, status, events, created_at
       FROM webhook_endpoints
       WHERE ai_account_id = ?
       ORDER BY created_at DESC`
    )
    .all(aiAccountId) as Array<{
    id: string;
    url: string;
    status: string;
    events: string | null;
    created_at: string;
  }>;

  return NextResponse.json({
    webhooks: webhooks.map((hook) => ({
      id: hook.id,
      url: hook.url,
      status: hook.status,
      events: hook.events
        ? hook.events
            .split(",")
            .map((event) => event.trim())
            .filter(Boolean)
        : ALLOWED_EVENTS,
      created_at: hook.created_at
    }))
  });
}
