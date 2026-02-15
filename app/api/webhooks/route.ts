import crypto from "crypto";
import { NextResponse } from "next/server";
import dns from "dns/promises";
import net from "net";
import { getDb } from "@/lib/db";
import {
  applyAiRateLimitHeaders,
  authenticateAiApiRequest,
  parseAiAccountIdFromRequest,
  parseAiApiKeyFromRequest
} from "@/lib/ai-api-auth";
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

const PRIVATE_IPV4_BLOCKS: Array<[number, number]> = [
  [0x0a000000, 0x0affffff], // 10.0.0.0/8
  [0xac100000, 0xac1fffff], // 172.16.0.0/12
  [0xc0a80000, 0xc0a8ffff], // 192.168.0.0/16
  [0x7f000000, 0x7fffffff], // 127.0.0.0/8
  [0xa9fe0000, 0xa9feffff], // 169.254.0.0/16
  [0x00000000, 0x00ffffff] // 0.0.0.0/8
];

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

function isPrivateIp(ip: string): boolean {
  const version = net.isIP(ip);
  if (version === 4) {
    const n = ipv4ToInt(ip);
    return PRIVATE_IPV4_BLOCKS.some(([start, end]) => n >= start && n <= end);
  }
  if (version === 6) {
    const v = ip.toLowerCase();
    return (
      v === "::1" ||
      v.startsWith("fc") ||
      v.startsWith("fd") ||
      v.startsWith("fe80:") ||
      v === "::"
    );
  }
  return true;
}

async function isValidWebhookUrl(url: string) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    const host = parsed.hostname.trim().toLowerCase();
    if (!host || host === "localhost" || host.endsWith(".local")) return false;
    if (net.isIP(host)) return !isPrivateIp(host);
    const resolved = await dns.lookup(host, { all: true });
    if (!resolved.length) return false;
    return resolved.every((entry) => !isPrivateIp(entry.address));
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  const payload: any = await request.json().catch(() => ({}));
  const aiAccountId =
    typeof payload?.ai_account_id === "string" ? payload.ai_account_id.trim() : "";
  const aiApiKey = typeof payload?.ai_api_key === "string" ? payload.ai_api_key.trim() : "";
  const url = typeof payload?.url === "string" ? payload.url.trim() : "";
  const events = parseEvents(payload?.events);

  if (!aiAccountId || !aiApiKey || !url || !events || !(await isValidWebhookUrl(url))) {
    return NextResponse.json({ status: "error", reason: "invalid_request" }, { status: 400 });
  }

  const db = getDb();
  const auth = await authenticateAiApiRequest(aiAccountId, aiApiKey);
  if (auth.ok === false) return auth.response;

  const id = crypto.randomUUID();
  const secret = generateWebhookSecret();
  const createdAt = new Date().toISOString();

  await db.prepare(
    `INSERT INTO webhook_endpoints (id, ai_account_id, url, secret, status, events, created_at)
     VALUES (?, ?, ?, ?, 'active', ?, ?)`
  ).run(id, aiAccountId, url, secret, events.join(","), createdAt);

  const response = NextResponse.json({
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
  return applyAiRateLimitHeaders(response, auth);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const aiAccountId = parseAiAccountIdFromRequest(request, url);
  const aiApiKey = parseAiApiKeyFromRequest(request);

  if (!aiAccountId || !aiApiKey) {
    return NextResponse.json({ status: "error", reason: "invalid_request" }, { status: 400 });
  }

  const db = getDb();
  const auth = await authenticateAiApiRequest(aiAccountId, aiApiKey);
  if (auth.ok === false) return auth.response;

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

  const response = NextResponse.json({
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
  return applyAiRateLimitHeaders(response, auth);
}
