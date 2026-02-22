import crypto from "crypto";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireMarketingApiKey } from "@/lib/marketing-api-auth";

function normalizeText(value: unknown, max = 10000) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function normalizeChannel(value: unknown) {
  const v = normalizeText(value, 40).toLowerCase();
  if (v === "x" || v === "tiktok") return v;
  return "x";
}

function normalizeFormat(value: unknown) {
  const v = normalizeText(value, 40).toLowerCase();
  if (v === "text" || v === "image" || v === "video") return v;
  return "text";
}

function normalizeHashtags(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => typeof item === "string" && item.trim())
    .map((item) => item.trim())
    .slice(0, 20);
}

function normalizeIsoDateTime(value: unknown) {
  const s = normalizeText(value, 100);
  if (!s) return "";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString();
}

function safeJsonParse(raw: unknown, fallback: any = null) {
  if (typeof raw !== "string") return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function normalizeSourceContext(payload: any) {
  const rawObject =
    payload?.source_context && typeof payload.source_context === "object" && !Array.isArray(payload.source_context)
      ? payload.source_context
      : safeJsonParse(payload?.source_context_json, {});
  const source: Record<string, unknown> = rawObject && typeof rawObject === "object" ? { ...rawObject } : {};

  const sourceType = normalizeText(payload?.source_type, 40).toLowerCase();
  const sourceUrl = normalizeText(payload?.source_url, 2000);
  const sourcePostId = normalizeText(payload?.source_post_id, 120);
  const sourceTitle = normalizeText(payload?.source_title, 300);
  const sourcePublisher = normalizeText(payload?.source_publisher, 120);
  const sourceDomain = normalizeText(payload?.source_domain, 120);
  const sourcePublishedAt = normalizeIsoDateTime(payload?.source_published_at);

  if (sourceType) source.source_type = sourceType;
  if (sourceUrl) source.source_url = sourceUrl;
  if (sourcePostId) source.source_post_id = sourcePostId;
  if (sourceTitle) source.source_title = sourceTitle;
  if (sourcePublisher) source.source_publisher = sourcePublisher;
  if (sourceDomain) source.source_domain = sourceDomain;
  if (sourcePublishedAt) source.source_published_at = sourcePublishedAt;

  const keys = Object.keys(source).filter((key) => source[key] !== null && source[key] !== undefined && source[key] !== "");
  if (!keys.length) return null;
  const normalized: Record<string, unknown> = {};
  for (const key of keys) {
    normalized[key] = source[key];
  }
  return normalized;
}

function hydrateContent(row: any) {
  if (!row) return row;
  const sourceContext = safeJsonParse(row.source_context_json, null);
  return {
    ...row,
    source_context: sourceContext
  };
}

export async function POST(request: Request) {
  const authError = requireMarketingApiKey(request);
  if (authError) return authError;

  const payload: any = await request.json().catch(() => ({}));
  const id = normalizeText(payload?.content_id, 120) || crypto.randomUUID();
  const briefId = normalizeText(payload?.brief_id, 120) || "manual";
  const channel = normalizeChannel(payload?.channel);
  const format = normalizeFormat(payload?.format);
  const title = normalizeText(payload?.title, 300) || null;
  const bodyText = normalizeText(payload?.body_text ?? payload?.body, 5000);
  const hashtags = normalizeHashtags(payload?.hashtags);
  const productUrl = normalizeText(payload?.product_url, 2000) || null;
  const sourceContext = normalizeSourceContext(payload);

  if (!bodyText) {
    return NextResponse.json({ status: "error", reason: "invalid_request" }, { status: 400 });
  }

  const now = new Date().toISOString();
  const db = getDb();
  await db
    .prepare(
      `INSERT INTO marketing_contents (
         id, brief_id, channel, format, title, body_text,
         asset_manifest_json, hashtags_json, metadata_json, version, status,
         product_url, source_context_json,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, NULL, 1, 'approved', ?, ?, ?, ?)`
    )
    .run(
      id,
      briefId,
      channel,
      format,
      title,
      bodyText,
      JSON.stringify(hashtags),
      productUrl,
      sourceContext ? JSON.stringify(sourceContext) : null,
      now,
      now
    );

  return NextResponse.json(
    {
      status: "ok",
      content: {
        id,
        brief_id: briefId,
        channel,
        format,
        title,
        body_text: bodyText,
        hashtags,
        product_url: productUrl,
        source_context: sourceContext,
        status: "approved",
        created_at: now
      }
    },
    { status: 201 }
  );
}

export async function GET(request: Request) {
  const authError = requireMarketingApiKey(request);
  if (authError) return authError;

  const db = getDb();
  const url = new URL(request.url);
  const contentId = normalizeText(url.searchParams.get("content_id"), 120);
  if (contentId) {
    const content = await db
      .prepare(
        `SELECT id, brief_id, channel, format, title, body_text, hashtags_json,
                product_url, source_context_json, status, created_at, updated_at
         FROM marketing_contents
         WHERE id = ?`
      )
      .get(contentId);
    if (!content) {
      return NextResponse.json({ status: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ status: "ok", content: hydrateContent(content) });
  }

  const limitInput = Number(url.searchParams.get("limit") || 20);
  const limit = Number.isFinite(limitInput)
    ? Math.max(1, Math.min(100, Math.trunc(limitInput)))
    : 20;
  const contents = await db
    .prepare(
      `SELECT id, brief_id, channel, format, title, body_text, hashtags_json,
              product_url, source_context_json, status, created_at, updated_at
       FROM marketing_contents
       ORDER BY updated_at DESC
       LIMIT ?`
    )
    .all(limit);
  return NextResponse.json({ status: "ok", contents: contents.map(hydrateContent) });
}
