import crypto from "crypto";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireMarketingApiKey } from "@/lib/marketing-api-auth";
import {
  deriveTopicFields,
  extractHostname,
  isAllowedHostname,
  normalizeMetadata,
  normalizeSourceContext,
  normalizeText,
  readMarketingIdentityPolicy,
  safeJsonParse
} from "@/lib/marketing-topic";

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

function hydrateContent(row: any) {
  if (!row) return row;
  const sourceContext = safeJsonParse(row.source_context_json, null);
  const metadata = safeJsonParse(row.metadata_json, null);
  return {
    ...row,
    metadata,
    campaign_id: row.campaign_id || metadata?.campaign_id || null,
    persona_id: row.persona_id || metadata?.persona_id || null,
    content_type: row.content_type || metadata?.content_type || null,
    slot_key: row.slot_key || metadata?.slot_key || null,
    planned_for: row.planned_for || metadata?.planned_for || null,
    source_context: sourceContext,
    topic_key: row.topic_key || null,
    topic_summary: row.topic_summary || null
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
  const metadata = normalizeMetadata(payload);
  const campaignId = normalizeText(payload?.campaign_id ?? metadata?.campaign_id, 120) || null;
  const personaId = normalizeText(payload?.persona_id ?? metadata?.persona_id, 120) || null;
  const contentType = normalizeText(payload?.content_type ?? metadata?.content_type, 80).toLowerCase() || null;
  const slotKey = normalizeText(payload?.slot_key ?? metadata?.slot_key, 40) || null;
  const plannedFor = normalizeText(payload?.planned_for ?? metadata?.planned_for, 40) || null;
  const sourceContext = normalizeSourceContext(payload);
  const { topicKey, topicSummary } = deriveTopicFields({
    title,
    bodyText,
    productUrl,
    sourceContext
  });

  if (!bodyText) {
    return NextResponse.json({ status: "error", reason: "invalid_request" }, { status: 400 });
  }

  const policy = readMarketingIdentityPolicy();
  if (policy.campaignId && campaignId !== policy.campaignId) {
    return NextResponse.json({ status: "error", reason: "campaign_mismatch" }, { status: 400 });
  }
  if (policy.personaId && personaId !== policy.personaId) {
    return NextResponse.json({ status: "error", reason: "persona_mismatch" }, { status: 400 });
  }

  const sourceHostname =
    normalizeText(sourceContext?.source_domain, 255).toLowerCase() ||
    extractHostname(sourceContext?.source_url) ||
    extractHostname(productUrl);
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

  const now = new Date().toISOString();
  const db = getDb();
  await db
    .prepare(
      `INSERT INTO marketing_contents (
         id, brief_id, channel, format, title, body_text,
         asset_manifest_json, hashtags_json, metadata_json, version, status,
         campaign_id, persona_id, content_type, slot_key, planned_for,
         product_url, source_context_json, topic_key, topic_summary,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, 1, 'approved', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      briefId,
      channel,
      format,
      title,
      bodyText,
      JSON.stringify(hashtags),
      metadata ? JSON.stringify(metadata) : null,
      campaignId,
      personaId,
      contentType,
      slotKey,
      plannedFor,
      productUrl,
      sourceContext ? JSON.stringify(sourceContext) : null,
      topicKey,
      topicSummary,
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
        metadata,
        campaign_id: campaignId,
        persona_id: personaId,
        content_type: contentType,
        slot_key: slotKey,
        planned_for: plannedFor,
        product_url: productUrl,
        source_context: sourceContext,
        topic_key: topicKey,
        topic_summary: topicSummary,
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
        `SELECT id, brief_id, channel, format, title, body_text, hashtags_json, metadata_json,
                campaign_id, persona_id, content_type, slot_key, planned_for,
                product_url, source_context_json, topic_key, topic_summary, status, created_at, updated_at
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
      `SELECT id, brief_id, channel, format, title, body_text, hashtags_json, metadata_json,
              campaign_id, persona_id, content_type, slot_key, planned_for,
              product_url, source_context_json, topic_key, topic_summary, status, created_at, updated_at
       FROM marketing_contents
       ORDER BY updated_at DESC
       LIMIT ?`
    )
    .all(limit);
  return NextResponse.json({ status: "ok", contents: contents.map(hydrateContent) });
}

export async function DELETE(request: Request) {
  const authError = requireMarketingApiKey(request);
  if (authError) return authError;

  const url = new URL(request.url);
  const contentId = normalizeText(url.searchParams.get("content_id"), 120);
  if (!contentId) {
    return NextResponse.json({ status: "error", reason: "invalid_request" }, { status: 400 });
  }

  const db = getDb();
  const content = await db
    .prepare(
      `SELECT id, campaign_id, persona_id, status, planned_for, slot_key
       FROM marketing_contents
       WHERE id = ?`
    )
    .get(contentId);
  if (!content) {
    return NextResponse.json({ status: "not_found" }, { status: 404 });
  }

  const policy = readMarketingIdentityPolicy();
  if (policy.campaignId && normalizeText((content as any).campaign_id, 120) !== policy.campaignId) {
    return NextResponse.json({ status: "error", reason: "campaign_mismatch" }, { status: 400 });
  }
  if (policy.personaId && normalizeText((content as any).persona_id, 120) !== policy.personaId) {
    return NextResponse.json({ status: "error", reason: "persona_mismatch" }, { status: 400 });
  }

  const published = await db
    .prepare(
      `SELECT id
       FROM marketing_posts
       WHERE content_id = ?
       LIMIT 1`
    )
    .get(contentId);
  if (published) {
    return NextResponse.json(
      { status: "error", reason: "content_already_published", content_id: contentId },
      { status: 409 }
    );
  }

  const queuedJob = await db
    .prepare(
      `SELECT id, status
       FROM marketing_publish_jobs
       WHERE content_id = ?
       LIMIT 1`
    )
    .get(contentId);
  if (queuedJob) {
    return NextResponse.json(
      {
        status: "error",
        reason: "content_has_publish_job",
        content_id: contentId,
        publish_job_id: (queuedJob as any).id,
        publish_job_status: (queuedJob as any).status
      },
      { status: 409 }
    );
  }

  const generationJob = await db
    .prepare(
      `SELECT id, status
       FROM marketing_generation_jobs
       WHERE content_id = ?
       LIMIT 1`
    )
    .get(contentId);
  if (generationJob) {
    return NextResponse.json(
      {
        status: "error",
        reason: "content_has_generation_job",
        content_id: contentId,
        generation_job_id: (generationJob as any).id,
        generation_job_status: (generationJob as any).status
      },
      { status: 409 }
    );
  }

  await db.prepare(`DELETE FROM marketing_contents WHERE id = ?`).run(contentId);

  return NextResponse.json({
    status: "ok",
    deleted: {
      id: contentId,
      planned_for: (content as any).planned_for || null,
      slot_key: (content as any).slot_key || null
    }
  });
}
