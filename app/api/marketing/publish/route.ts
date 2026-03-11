import crypto from "crypto";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireMarketingApiKey } from "@/lib/marketing-api-auth";
import {
  deriveTopicFields,
  extractHostname,
  findRecentTopicDuplicate,
  isAllowedHostname,
  normalizeText,
  parseSourceContext,
  readMarketingIdentityPolicy
} from "@/lib/marketing-topic";

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

async function validateSourceLink(url: string) {
  if (!url) return { ok: true as const, status: null as number | null };
  try {
    const headResponse = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(8000)
    });
    if (headResponse.ok) {
      return { ok: true as const, status: headResponse.status };
    }
    if (headResponse.status === 405 || headResponse.status === 501) {
      const getResponse = await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal: AbortSignal.timeout(8000)
      });
      return { ok: getResponse.ok, status: getResponse.status };
    }
    return { ok: false as const, status: headResponse.status };
  } catch {
    return { ok: false as const, status: null };
  }
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
    .prepare(
      `SELECT id, channel, status, campaign_id, persona_id, content_type, slot_key, planned_for,
              title, body_text, product_url, source_context_json, topic_key, topic_summary
       FROM marketing_contents
       WHERE id = ?`
    )
    .get(contentId);
  if (!content) {
    return NextResponse.json({ status: "error", reason: "content_not_found" }, { status: 404 });
  }

  const channel = requestedChannel || normalizeChannel((content as any).channel) || "x";
  const sourceContext = parseSourceContext((content as any).source_context_json);
  const policy = readMarketingIdentityPolicy();
  if (policy.campaignId && normalizeText((content as any).campaign_id, 120) !== policy.campaignId) {
    return NextResponse.json({ status: "error", reason: "campaign_mismatch" }, { status: 400 });
  }
  if (policy.personaId && normalizeText((content as any).persona_id, 120) !== policy.personaId) {
    return NextResponse.json({ status: "error", reason: "persona_mismatch" }, { status: 400 });
  }

  const sourceUrl =
    normalizeText(sourceContext?.source_url, 2000) ||
    normalizeText((content as any).product_url, 2000);
  const sourceHostname =
    normalizeText(sourceContext?.source_domain, 255).toLowerCase() ||
    extractHostname(sourceUrl);
  if (!isAllowedHostname(sourceHostname, policy.sourceWhitelist)) {
    return NextResponse.json(
      {
        status: "error",
        reason: "source_domain_not_allowed",
        source_domain: sourceHostname || null
      },
      { status: 400 }
    );
  }
  const sourceLink = await validateSourceLink(sourceUrl);
  if (!sourceLink.ok) {
    return NextResponse.json(
      {
        status: "error",
        reason: "source_link_unhealthy",
        source_url: sourceUrl || null,
        http_status: sourceLink.status
      },
      { status: 400 }
    );
  }

  const derivedTopic = deriveTopicFields({
    title: (content as any).title,
    bodyText: (content as any).body_text,
    productUrl: (content as any).product_url,
    sourceContext
  });
  const topicKey = normalizeText((content as any).topic_key, 500) || derivedTopic.topicKey;
  const topicSummary = normalizeText((content as any).topic_summary, 240) || derivedTopic.topicSummary;
  if (
    topicKey !== ((content as any).topic_key || null) ||
    topicSummary !== ((content as any).topic_summary || null)
  ) {
    await db
      .prepare(
        `UPDATE marketing_contents
         SET topic_key = ?, topic_summary = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(topicKey, topicSummary, scheduledAt, contentId);
  }

  const duplicate = await findRecentTopicDuplicate(db, {
    contentId,
    channel,
    topicKey,
    topicSummary,
    title: (content as any).title,
    bodyText: (content as any).body_text,
    productUrl: (content as any).product_url,
    sourceContext
  });
  if (duplicate) {
    return NextResponse.json(
      {
        status: "error",
        reason: "duplicate_topic_recently_used",
        duplicate
      },
      { status: 409 }
    );
  }

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
        campaign_id: (content as any).campaign_id || null,
        persona_id: (content as any).persona_id || null,
        content_type: (content as any).content_type || null,
        slot_key: (content as any).slot_key || null,
        planned_for: (content as any).planned_for || null,
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
