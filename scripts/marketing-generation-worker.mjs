import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import Database from "better-sqlite3";
import pg from "pg";

const { Pool } = pg;

const DB_PATH = path.join(process.cwd(), "data", "app.db");
const DATABASE_URL = (process.env.DATABASE_URL || "").trim();

const WORKER_ENABLED = process.env.MARKETING_GENERATION_WORKER_ENABLED === "true";
// Keep this second explicit gate to avoid accidental activation in production.
const EXECUTE_PLACEHOLDER = process.env.MARKETING_GENERATION_PLACEHOLDER_EXECUTE === "true";
const CONTINUOUS = process.env.MARKETING_GENERATION_WORKER_CONTINUOUS === "true";
const POLL_INTERVAL_MS = Number(process.env.MARKETING_GENERATION_WORKER_POLL_MS || 15000);
const BATCH_SIZE = Number(process.env.MARKETING_GENERATION_WORKER_BATCH_SIZE || 10);
const MAX_ATTEMPTS = Number(process.env.MARKETING_GENERATION_MAX_ATTEMPTS || 5);

const SEEDREAM_IMAGE_ENDPOINT = process.env.SEEDREAM_IMAGE_ENDPOINT || "/images/generations";
const SEEDANCE_VIDEO_ENDPOINT = process.env.SEEDANCE_VIDEO_ENDPOINT || "/videos/generations";
const SEEDREAM_TIMEOUT_MS = Number(process.env.SEEDREAM_TIMEOUT_MS || 60000);
const SEEDANCE_TIMEOUT_MS = Number(process.env.SEEDANCE_TIMEOUT_MS || 120000);

function nowIso() {
  return new Date().toISOString();
}

function toPgSql(sql) {
  let index = 0;
  let out = "";
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    if (ch === "?") {
      index += 1;
      out += `$${index}`;
    } else {
      out += ch;
    }
  }
  return out;
}

function safeJsonParse(raw, fallback = null) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function safeJsonStringify(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function pickFirstString(candidates) {
  for (const item of candidates) {
    if (typeof item === "string" && item.trim()) {
      return item.trim();
    }
  }
  return null;
}

function pickFirstNumber(candidates) {
  for (const item of candidates) {
    const value = Number(item);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function nextBackoffSeconds(attemptCount) {
  const schedule = [30, 120, 600, 1800, 7200];
  return schedule[Math.min(attemptCount, schedule.length - 1)];
}

class ProviderRequestError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = "ProviderRequestError";
    this.code = code;
    this.retryable = Boolean(options.retryable);
    this.httpStatus = options.httpStatus ?? null;
    this.rawBody = options.rawBody ?? null;
  }
}

function normalizeErrorCode(code) {
  if (!code) return "unknown";
  const v = String(code).trim().toLowerCase();
  if (
    v === "bad_request" ||
    v === "unauthorized" ||
    v === "rate_limited" ||
    v === "provider_unavailable" ||
    v === "content_policy_violation" ||
    v === "timeout" ||
    v === "unknown"
  ) {
    return v;
  }
  return "unknown";
}

function toErrorCodeFromHttp(status) {
  if (status === 400) return "bad_request";
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 429) return "rate_limited";
  if (status === 408 || status === 504) return "timeout";
  if (status >= 500) return "provider_unavailable";
  return "unknown";
}

function getPgPool() {
  const pgSslMode = (process.env.PGSSLMODE || "").trim().toLowerCase();
  let useSsl = false;
  let connectionString = DATABASE_URL;
  try {
    const parsed = new URL(DATABASE_URL);
    const sslModeFromUrl = parsed.searchParams.get("sslmode")?.trim().toLowerCase();
    const sslFromUrl = parsed.searchParams.get("ssl")?.trim().toLowerCase();
    useSsl =
      sslModeFromUrl === "require" ||
      sslModeFromUrl === "prefer" ||
      sslFromUrl === "true" ||
      sslFromUrl === "1";
    if (useSsl) {
      parsed.searchParams.delete("sslmode");
      parsed.searchParams.delete("ssl");
      connectionString = parsed.toString();
    }
  } catch {
    const lowerUrl = DATABASE_URL.toLowerCase();
    useSsl = lowerUrl.includes("sslmode=require") || lowerUrl.includes("ssl=true");
  }
  if (pgSslMode === "require") useSsl = true;

  return new Pool({
    connectionString,
    ssl: useSsl ? { rejectUnauthorized: false } : undefined
  });
}

function openSqlite() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  return db;
}

function buildDb() {
  if (DATABASE_URL) {
    const pool = getPgPool();
    return {
      async all(sql, params = []) {
        const result = await pool.query(toPgSql(sql), params);
        return result.rows;
      },
      async run(sql, params = []) {
        const result = await pool.query(toPgSql(sql), params);
        return result.rowCount ?? 0;
      },
      async close() {
        await pool.end();
      }
    };
  }

  const db = openSqlite();
  return {
    async all(sql, params = []) {
      return db.prepare(sql).all(...params);
    },
    async run(sql, params = []) {
      const info = db.prepare(sql).run(...params);
      return info.changes;
    },
    async close() {
      db.close();
    }
  };
}

function isProviderConfigured() {
  const hasSeedance =
    Boolean((process.env.SEEDANCE_API_KEY || "").trim()) &&
    Boolean((process.env.SEEDANCE_BASE_URL || "").trim()) &&
    Boolean((process.env.SEEDANCE_MODEL || "").trim());
  const hasSeedream =
    Boolean((process.env.SEEDREAM_API_KEY || "").trim()) &&
    Boolean((process.env.SEEDREAM_BASE_URL || "").trim()) &&
    Boolean((process.env.SEEDREAM_MODEL || "").trim());
  return hasSeedance || hasSeedream;
}

function buildProviderConfig(job) {
  const requestedProvider = String(job.provider || "").trim().toLowerCase();
  const assetType = String(job.asset_type || "").trim().toLowerCase();

  if (requestedProvider === "seedance" || assetType === "video") {
    const apiKey = (process.env.SEEDANCE_API_KEY || "").trim();
    const baseUrl = (process.env.SEEDANCE_BASE_URL || "").trim();
    const model = String(job.model || process.env.SEEDANCE_MODEL || "").trim();
    if (!apiKey || !baseUrl || !model) {
      throw new ProviderRequestError("bad_request", "seedance config missing", {
        retryable: false
      });
    }
    return {
      provider: "seedance",
      apiKey,
      baseUrl: baseUrl.replace(/\/$/, ""),
      model,
      endpoint: SEEDANCE_VIDEO_ENDPOINT,
      timeoutMs: SEEDANCE_TIMEOUT_MS,
      assetType: "video"
    };
  }

  const apiKey = (process.env.SEEDREAM_API_KEY || "").trim();
  const baseUrl = (process.env.SEEDREAM_BASE_URL || "").trim();
  const model = String(job.model || process.env.SEEDREAM_MODEL || "").trim();
  if (!apiKey || !baseUrl || !model) {
    throw new ProviderRequestError("bad_request", "seedream config missing", {
      retryable: false
    });
  }
  return {
    provider: "seedream",
    apiKey,
    baseUrl: baseUrl.replace(/\/$/, ""),
    model,
    endpoint: SEEDREAM_IMAGE_ENDPOINT,
    timeoutMs: SEEDREAM_TIMEOUT_MS,
    assetType: "image"
  };
}

function buildGenerationPayload(job, providerConfig) {
  const requestJson = safeJsonParse(job.request_json, {});
  const requestPatch =
    requestJson && typeof requestJson === "object" && requestJson.request && typeof requestJson.request === "object"
      ? requestJson.request
      : requestJson;

  const payload = {
    ...(requestPatch && typeof requestPatch === "object" ? requestPatch : {}),
    model: providerConfig.model,
    prompt: job.prompt,
    negative_prompt: job.prompt_negative || undefined,
    seed: Number.isInteger(job.seed) ? Number(job.seed) : undefined
  };

  if (providerConfig.assetType === "video") {
    if (!payload.duration_sec) payload.duration_sec = 15;
    if (!payload.aspect_ratio) payload.aspect_ratio = "9:16";
    if (!payload.fps) payload.fps = 24;
    if (!payload.resolution) payload.resolution = "720p";
  } else {
    if (!payload.output_format) payload.output_format = "png";
  }

  return payload;
}

function parseGenerationOutput(rawBody, providerAssetType) {
  const body = safeJsonParse(rawBody, {});

  const row0 =
    (Array.isArray(body?.data) && body.data[0]) ||
    (Array.isArray(body?.outputs) && body.outputs[0]) ||
    (Array.isArray(body?.result) && body.result[0]) ||
    body?.data ||
    body?.output ||
    body?.result ||
    {};

  const outputUrl = pickFirstString([
    row0?.url,
    row0?.output_url,
    row0?.video_url,
    row0?.image_url,
    body?.url,
    body?.output_url,
    body?.video_url,
    body?.image_url
  ]);

  if (!outputUrl) {
    throw new ProviderRequestError("unknown", "provider response missing output url", {
      retryable: false,
      rawBody
    });
  }

  return {
    outputUrl,
    thumbUrl: pickFirstString([row0?.thumb_url, row0?.thumbnail_url, body?.thumb_url, body?.thumbnail_url]),
    posterUrl: pickFirstString([row0?.poster_url, body?.poster_url]),
    mimeType: pickFirstString([row0?.mime_type, body?.mime_type]),
    width: pickFirstNumber([row0?.width, body?.width]),
    height: pickFirstNumber([row0?.height, body?.height]),
    durationSec:
      providerAssetType === "video"
        ? pickFirstNumber([row0?.duration_sec, row0?.duration, body?.duration_sec, body?.duration])
        : null,
    costJpy: pickFirstNumber([body?.cost_jpy, row0?.cost_jpy]),
    providerSeed: pickFirstNumber([body?.seed, row0?.seed]),
    rawResponseJson: rawBody
  };
}

async function requestProvider(job) {
  const provider = buildProviderConfig(job);
  const payload = buildGenerationPayload(job, provider);
  const startedAtMs = Date.now();

  let response;
  try {
    response = await fetch(`${provider.baseUrl}${provider.endpoint}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(provider.timeoutMs)
    });
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      throw new ProviderRequestError("timeout", "provider timeout", { retryable: true });
    }
    throw new ProviderRequestError("provider_unavailable", "provider request failed", {
      retryable: true
    });
  }

  const raw = await response.text();
  if (!response.ok) {
    const code = toErrorCodeFromHttp(response.status);
    const retryable = response.status === 429 || response.status >= 500;
    throw new ProviderRequestError(code, `provider http ${response.status}`, {
      retryable,
      httpStatus: response.status,
      rawBody: raw
    });
  }

  const parsed = parseGenerationOutput(raw, provider.assetType);

  return {
    provider: provider.provider,
    model: provider.model,
    assetType: provider.assetType,
    sourcePrompt: job.prompt,
    seed: parsed.providerSeed ?? (Number.isInteger(job.seed) ? Number(job.seed) : null),
    outputUrl: parsed.outputUrl,
    thumbUrl: provider.assetType === "image" ? parsed.thumbUrl : parsed.posterUrl,
    mimeType: parsed.mimeType,
    width: parsed.width,
    height: parsed.height,
    durationSec: parsed.durationSec,
    latencyMs: Date.now() - startedAtMs,
    costJpy: parsed.costJpy,
    rawResponseJson: parsed.rawResponseJson,
    requestJson: safeJsonStringify(payload)
  };
}

async function claimQueuedJobs(db) {
  return db.all(
    `SELECT id, content_id, asset_type, provider, model, status,
            prompt, prompt_negative, seed, request_json,
            attempt_count, created_at
     FROM marketing_generation_jobs
     WHERE status = 'queued'
       AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
     ORDER BY created_at ASC
     LIMIT ?`,
    [nowIso(), BATCH_SIZE]
  );
}

async function markProcessing(db, job) {
  const now = nowIso();
  const claimed = await db.run(
    `UPDATE marketing_generation_jobs
     SET status = 'processing',
         updated_at = ?,
         error_code = NULL,
         error_message = NULL
     WHERE id = ? AND status = 'queued'`,
    [now, job.id]
  );

  if (claimed > 0) {
    await db.run(
      `UPDATE marketing_contents
       SET generation_status = 'processing',
           generation_error_code = NULL,
           generation_error_message = NULL,
           updated_at = ?
       WHERE id = ?`,
      [now, job.content_id]
    );
  }

  return claimed;
}

async function markSucceeded(db, job, result) {
  const now = nowIso();
  await db.run(
    `UPDATE marketing_generation_jobs
     SET status = 'succeeded',
         provider = ?,
         model = ?,
         response_json = ?,
         request_json = COALESCE(?, request_json),
         retryable = 0,
         attempt_count = ?,
         latency_ms = ?,
         cost_jpy = ?,
         error_code = NULL,
         error_message = NULL,
         next_attempt_at = NULL,
         updated_at = ?,
         finished_at = ?
     WHERE id = ?`,
    [
      result.provider,
      result.model,
      result.rawResponseJson,
      result.requestJson,
      Number(job.attempt_count || 0) + 1,
      Number(result.latencyMs || 0),
      Number.isFinite(Number(result.costJpy)) ? Number(result.costJpy) : null,
      now,
      now,
      job.id
    ]
  );

  await db.run(
    `UPDATE marketing_contents
     SET generation_provider = ?,
         generation_model = ?,
         generation_prompt = ?,
         generation_seed = ?,
         generation_status = 'succeeded',
         generation_error_code = NULL,
         generation_error_message = NULL,
         generation_latency_ms = ?,
         generation_cost_jpy = ?,
         generation_raw_response_json = ?,
         media_asset_url = ?,
         media_thumb_url = ?,
         media_duration_sec = ?,
         media_width = ?,
         media_height = ?,
         media_mime_type = ?,
         updated_at = ?
     WHERE id = ?`,
    [
      result.provider,
      result.model,
      result.sourcePrompt || null,
      Number.isFinite(Number(result.seed)) ? Number(result.seed) : null,
      Number(result.latencyMs || 0),
      Number.isFinite(Number(result.costJpy)) ? Number(result.costJpy) : null,
      result.rawResponseJson || null,
      result.outputUrl,
      result.thumbUrl || null,
      Number.isFinite(Number(result.durationSec)) ? Number(result.durationSec) : null,
      Number.isFinite(Number(result.width)) ? Number(result.width) : null,
      Number.isFinite(Number(result.height)) ? Number(result.height) : null,
      result.mimeType || null,
      now,
      job.content_id
    ]
  );
}

async function markFailed(db, job, error) {
  const now = nowIso();
  const attemptCount = Number(job.attempt_count || 0) + 1;
  const code = normalizeErrorCode(error?.code);
  const message = String(error?.message || "unknown_error").slice(0, 500);
  const retryable = Boolean(error?.retryable) && attemptCount < MAX_ATTEMPTS;
  const nextAttemptAt = retryable
    ? new Date(Date.now() + nextBackoffSeconds(attemptCount - 1) * 1000).toISOString()
    : null;

  await db.run(
    `UPDATE marketing_generation_jobs
     SET status = ?,
         error_code = ?,
         error_message = ?,
         retryable = ?,
         response_json = COALESCE(?, response_json),
         attempt_count = ?,
         next_attempt_at = ?,
         updated_at = ?,
         finished_at = ?
     WHERE id = ?`,
    [
      retryable ? "queued" : "failed",
      code,
      message,
      retryable ? 1 : 0,
      error?.rawBody || null,
      attemptCount,
      nextAttemptAt,
      now,
      retryable ? null : now,
      job.id
    ]
  );

  await db.run(
    `UPDATE marketing_contents
     SET generation_status = ?,
         generation_error_code = ?,
         generation_error_message = ?,
         updated_at = ?
     WHERE id = ?`,
    [retryable ? "queued" : "failed", code, message, now, job.content_id]
  );
}

async function processJob(db, job) {
  const claimed = await markProcessing(db, job);
  if (claimed < 1) return;

  try {
    const result = await requestProvider(job);
    await markSucceeded(db, job, result);
  } catch (error) {
    await markFailed(db, job, error);
  }
}

async function runOnce(db) {
  const jobs = await claimQueuedJobs(db);
  for (const job of jobs) {
    await processJob(db, job);
  }
  return jobs.length;
}

async function main() {
  if (!WORKER_ENABLED) {
    console.log("marketing generation worker is disabled (MARKETING_GENERATION_WORKER_ENABLED!=true)");
    return;
  }

  if (!isProviderConfigured()) {
    console.log("marketing generation worker skipped: provider env is not configured");
    return;
  }
  if (!EXECUTE_PLACEHOLDER) {
    console.log(
      "marketing generation worker is in safe mode (set MARKETING_GENERATION_PLACEHOLDER_EXECUTE=true to run provider execution)"
    );
    return;
  }

  const db = buildDb();
  try {
    if (!CONTINUOUS) {
      await runOnce(db);
      return;
    }
    while (true) {
      const handled = await runOnce(db);
      const waitMs = handled > 0 ? 1000 : POLL_INTERVAL_MS;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error("marketing generation worker failed", error);
  process.exit(1);
});
