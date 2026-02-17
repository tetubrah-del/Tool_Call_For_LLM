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
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, NULL, 1, 'approved', ?, ?)`
    )
    .run(id, briefId, channel, format, title, bodyText, JSON.stringify(hashtags), now, now);

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
        `SELECT id, brief_id, channel, format, title, body_text, hashtags_json, status, created_at, updated_at
         FROM marketing_contents
         WHERE id = ?`
      )
      .get(contentId);
    if (!content) {
      return NextResponse.json({ status: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ status: "ok", content });
  }

  const limitInput = Number(url.searchParams.get("limit") || 20);
  const limit = Number.isFinite(limitInput)
    ? Math.max(1, Math.min(100, Math.trunc(limitInput)))
    : 20;
  const contents = await db
    .prepare(
      `SELECT id, brief_id, channel, format, title, body_text, hashtags_json, status, created_at, updated_at
       FROM marketing_contents
       ORDER BY updated_at DESC
       LIMIT ?`
    )
    .all(limit);
  return NextResponse.json({ status: "ok", contents });
}
