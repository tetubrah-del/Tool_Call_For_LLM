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
  return "";
}

function normalizeIsoDateTime(value: unknown) {
  const s = normalizeText(value, 100);
  if (!s) return "";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString();
}

export async function POST(request: Request) {
  const authError = requireMarketingApiKey(request);
  if (authError) return authError;

  const payload: any = await request.json().catch(() => ({}));
  const contentId = normalizeText(payload?.content_id, 120);
  const requestedChannel = normalizeChannel(payload?.channel);
  const scheduledAt = normalizeIsoDateTime(payload?.scheduled_at) || new Date().toISOString();
  if (!contentId) {
    return NextResponse.json({ status: "error", reason: "invalid_request" }, { status: 400 });
  }

  const db = getDb();
  const content = await db
    .prepare(`SELECT id, channel, status FROM marketing_contents WHERE id = ?`)
    .get(contentId);
  if (!content) {
    return NextResponse.json({ status: "error", reason: "content_not_found" }, { status: 404 });
  }

  const channel = requestedChannel || normalizeChannel((content as any).channel) || "x";
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  await db
    .prepare(
      `INSERT INTO marketing_publish_jobs (
         id, content_id, channel, scheduled_at, status,
         attempt_count, next_attempt_at, last_error, created_at, updated_at
       ) VALUES (?, ?, ?, ?, 'queued', 0, NULL, NULL, ?, ?)`
    )
    .run(id, contentId, channel, scheduledAt, now, now);

  await db
    .prepare(
      `UPDATE marketing_contents
       SET status = 'publish_queued',
           updated_at = ?
       WHERE id = ?`
    )
    .run(now, contentId);

  return NextResponse.json(
    {
      status: "queued",
      job: {
        id,
        content_id: contentId,
        channel,
        scheduled_at: scheduledAt,
        publish_status: "queued",
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
  const jobId = normalizeText(url.searchParams.get("job_id"), 120);
  if (jobId) {
    const job = await db
      .prepare(
        `SELECT id, content_id, channel, scheduled_at, status,
                attempt_count, next_attempt_at, last_error, created_at, updated_at
         FROM marketing_publish_jobs
         WHERE id = ?`
      )
      .get(jobId);
    if (!job) {
      return NextResponse.json({ status: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ status: "ok", job });
  }

  const contentId = normalizeText(url.searchParams.get("content_id"), 120);
  const status = normalizeText(url.searchParams.get("status"), 40);
  const limitInput = Number(url.searchParams.get("limit") || 20);
  const limit = Number.isFinite(limitInput)
    ? Math.max(1, Math.min(100, Math.trunc(limitInput)))
    : 20;

  const where: string[] = [];
  const params: Array<string | number | null> = [];
  if (contentId) {
    where.push("content_id = ?");
    params.push(contentId);
  }
  if (status) {
    where.push("status = ?");
    params.push(status);
  }

  const jobs = await db
    .prepare(
      `SELECT id, content_id, channel, scheduled_at, status,
              attempt_count, next_attempt_at, last_error, created_at, updated_at
       FROM marketing_publish_jobs
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .all(...params, limit);

  return NextResponse.json({ status: "ok", jobs });
}
