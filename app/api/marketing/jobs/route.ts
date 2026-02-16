import crypto from "crypto";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireMarketingApiKey } from "@/lib/marketing-api-auth";

type AssetType = "image" | "video";

function normalizeAssetType(value: unknown): AssetType | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  if (v === "image" || v === "video") return v;
  return null;
}

function normalizeText(value: unknown, max = 10000) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function safeJsonStringify(value: unknown): string | null {
  if (value == null) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function pickDefaultProvider(assetType: AssetType) {
  if (assetType === "video") {
    return {
      provider: "seedance",
      model: normalizeText(process.env.SEEDANCE_MODEL, 200)
    };
  }
  return {
    provider: "seedream",
    model: normalizeText(process.env.SEEDREAM_MODEL, 200)
  };
}

export async function POST(request: Request) {
  const authError = requireMarketingApiKey(request);
  if (authError) return authError;

  const payload: any = await request.json().catch(() => ({}));
  const contentId = normalizeText(payload?.content_id, 120);
  const assetType = normalizeAssetType(payload?.asset_type);
  const prompt = normalizeText(payload?.prompt, 5000);
  const promptNegative = normalizeText(payload?.prompt_negative, 2000);
  const seedRaw = payload?.seed;
  const seed = Number.isInteger(seedRaw) ? Number(seedRaw) : null;

  if (!contentId || !assetType || !prompt) {
    return NextResponse.json({ status: "error", reason: "invalid_request" }, { status: 400 });
  }

  const defaults = pickDefaultProvider(assetType);
  const provider = normalizeText(payload?.provider, 80) || defaults.provider;
  const model = normalizeText(payload?.model, 200) || defaults.model;
  if (!model) {
    return NextResponse.json(
      { status: "error", reason: "missing_model_config" },
      { status: 400 }
    );
  }

  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  const db = getDb();
  await db
    .prepare(
      `INSERT INTO marketing_generation_jobs (
         id, content_id, asset_type, provider, model, status,
         prompt, prompt_negative, seed, request_json, response_json,
         error_code, error_message, retryable, attempt_count,
         next_attempt_at, latency_ms, cost_jpy, created_at, updated_at, finished_at
       ) VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, NULL, NULL, NULL, 0, 0, NULL, NULL, NULL, ?, ?, NULL)`
    )
    .run(
      id,
      contentId,
      assetType,
      provider,
      model,
      prompt,
      promptNegative || null,
      seed,
      safeJsonStringify(payload?.request) || safeJsonStringify(payload),
      now,
      now
    );

  await db
    .prepare(
      `UPDATE marketing_contents
       SET generation_provider = ?,
           generation_model = ?,
           generation_prompt = ?,
           generation_seed = ?,
           generation_status = 'queued',
           generation_error_code = NULL,
           generation_error_message = NULL,
           updated_at = ?
       WHERE id = ?`
    )
    .run(provider, model, prompt, seed, now, contentId);

  return NextResponse.json(
    {
      status: "queued",
      job: {
        id,
        content_id: contentId,
        asset_type: assetType,
        provider,
        model,
        generation_status: "queued",
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
        `SELECT id, content_id, asset_type, provider, model, status,
                error_code, error_message, retryable, attempt_count,
                next_attempt_at, latency_ms, cost_jpy, created_at, updated_at, finished_at
         FROM marketing_generation_jobs
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
      `SELECT id, content_id, asset_type, provider, model, status,
              error_code, error_message, retryable, attempt_count,
              next_attempt_at, latency_ms, cost_jpy, created_at, updated_at, finished_at
       FROM marketing_generation_jobs
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .all(...params, limit);

  return NextResponse.json({ status: "ok", jobs });
}
