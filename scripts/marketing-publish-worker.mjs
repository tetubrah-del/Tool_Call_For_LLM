import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import Database from "better-sqlite3";
import pg from "pg";

const { Pool } = pg;

const DB_PATH = path.join(process.cwd(), "data", "app.db");
const DATABASE_URL = (process.env.DATABASE_URL || "").trim();

const WORKER_ENABLED = process.env.MARKETING_PUBLISH_WORKER_ENABLED === "true";
const EXECUTE_PLACEHOLDER = process.env.MARKETING_PUBLISH_PLACEHOLDER_EXECUTE === "true";
const CONTINUOUS = process.env.MARKETING_PUBLISH_WORKER_CONTINUOUS === "true";
const POLL_INTERVAL_MS = Number(process.env.MARKETING_PUBLISH_WORKER_POLL_MS || 15000);
const BATCH_SIZE = Number(process.env.MARKETING_PUBLISH_WORKER_BATCH_SIZE || 10);
const MAX_ATTEMPTS = Number(process.env.MARKETING_PUBLISH_MAX_ATTEMPTS || 5);

const X_POSTS_BASE_URL = (process.env.MARKETING_X_POSTS_BASE_URL || "https://api.x.com").trim().replace(/\/$/, "");
const X_USER_ACCESS_TOKEN = (process.env.MARKETING_X_USER_ACCESS_TOKEN || "").trim();
const X_USER_ACCESS_TOKEN_SECRET = (process.env.MARKETING_X_USER_ACCESS_TOKEN_SECRET || "").trim();
const X_API_KEY = (process.env.MARKETING_X_API_KEY || "").trim();
const X_API_SECRET = (process.env.MARKETING_X_API_SECRET || "").trim();
const X_TIMEOUT_MS = Number(process.env.MARKETING_X_TIMEOUT_MS || 30000);

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

function nextBackoffSeconds(attemptCount) {
  const schedule = [30, 120, 600, 1800, 7200];
  return schedule[Math.min(attemptCount, schedule.length - 1)];
}

class PublishRequestError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = "PublishRequestError";
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
    v === "timeout" ||
    v === "unknown"
  ) {
    return v;
  }
  return "unknown";
}

function toErrorCodeFromHttp(status) {
  if (status === 400 || status === 404) return "bad_request";
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
      async get(sql, params = []) {
        const result = await pool.query(toPgSql(sql), params);
        return result.rows?.[0] || null;
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
    async get(sql, params = []) {
      return db.prepare(sql).get(...params) || null;
    },
    async close() {
      db.close();
    }
  };
}

async function ensurePublishTables(db) {
  const statements = [
    `CREATE TABLE IF NOT EXISTS marketing_contents (
      id TEXT PRIMARY KEY,
      brief_id TEXT NOT NULL,
      channel TEXT NOT NULL,
      format TEXT NOT NULL,
      title TEXT,
      body_text TEXT NOT NULL,
      hashtags_json TEXT,
      status TEXT NOT NULL,
      media_asset_url TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS marketing_publish_jobs (
      id TEXT PRIMARY KEY,
      content_id TEXT NOT NULL,
      channel TEXT NOT NULL,
      scheduled_at TEXT NOT NULL,
      status TEXT NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS marketing_posts (
      id TEXT PRIMARY KEY,
      content_id TEXT NOT NULL,
      channel TEXT NOT NULL,
      external_post_id TEXT NOT NULL,
      post_url TEXT,
      published_at TEXT NOT NULL,
      raw_response_json TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS marketing_publish_jobs_status_next_attempt_idx
      ON marketing_publish_jobs (status, next_attempt_at)`
  ];
  for (const sql of statements) {
    await db.run(sql);
  }
}

function isPublisherConfigured() {
  return isOAuth1Configured() || isOAuth2BearerConfigured();
}

function isOAuth1Configured() {
  return (
    Boolean(X_API_KEY) &&
    Boolean(X_API_SECRET) &&
    Boolean(X_USER_ACCESS_TOKEN) &&
    Boolean(X_USER_ACCESS_TOKEN_SECRET)
  );
}

function isOAuth2BearerConfigured() {
  return Boolean(X_USER_ACCESS_TOKEN);
}

function percentEncode(input) {
  return encodeURIComponent(String(input))
    .replace(/[!'()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
}

function buildOAuth1Header(method, url) {
  const oauthParams = {
    oauth_consumer_key: X_API_KEY,
    oauth_nonce: crypto.randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: `${Math.floor(Date.now() / 1000)}`,
    oauth_token: X_USER_ACCESS_TOKEN,
    oauth_version: "1.0"
  };

  const parsed = new URL(url);
  const queryPairs = [];
  parsed.searchParams.forEach((value, key) => {
    queryPairs.push([key, value]);
  });

  const oauthPairs = Object.entries(oauthParams);
  const allPairs = [...queryPairs, ...oauthPairs].map(([k, v]) => [percentEncode(k), percentEncode(v)]);
  allPairs.sort((a, b) => {
    if (a[0] === b[0]) return a[1].localeCompare(b[1]);
    return a[0].localeCompare(b[0]);
  });
  const normalizedParams = allPairs.map(([k, v]) => `${k}=${v}`).join("&");

  const baseUrl = `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  const baseString = [method.toUpperCase(), percentEncode(baseUrl), percentEncode(normalizedParams)].join("&");
  const signingKey = `${percentEncode(X_API_SECRET)}&${percentEncode(X_USER_ACCESS_TOKEN_SECRET)}`;
  const signature = crypto.createHmac("sha1", signingKey).update(baseString).digest("base64");

  const headerParams = {
    ...oauthParams,
    oauth_signature: signature
  };
  const headerValue = Object.entries(headerParams)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, v]) => `${percentEncode(k)}="${percentEncode(v)}"`)
    .join(", ");

  return `OAuth ${headerValue}`;
}

function pickFirstString(candidates) {
  for (const item of candidates) {
    if (typeof item === "string" && item.trim()) return item.trim();
  }
  return null;
}

function buildXText(content) {
  const title = String(content.title || "").trim();
  const body = String(content.body_text || "").trim();
  const hashtags = safeJsonParse(content.hashtags_json, []);
  const tags =
    Array.isArray(hashtags) && hashtags.length > 0
      ? hashtags
          .filter((v) => typeof v === "string" && v.trim())
          .map((v) => (v.trim().startsWith("#") ? v.trim() : `#${v.trim()}`))
          .join(" ")
      : "";

  const chunks = [title, body, tags].filter(Boolean);
  let text = chunks.join("\n\n").trim();
  if (!text) {
    throw new PublishRequestError("bad_request", "content text is empty", { retryable: false });
  }
  if (text.length > 280) {
    text = `${text.slice(0, 277)}...`;
  }
  return text;
}

async function publishToX(content) {
  if (!isPublisherConfigured()) {
    throw new PublishRequestError("bad_request", "x auth env is missing", {
      retryable: false
    });
  }
  const text = buildXText(content);
  const payload = { text };
  const postUrl = `${X_POSTS_BASE_URL}/2/tweets`;
  const authHeader = isOAuth1Configured()
    ? buildOAuth1Header("POST", postUrl)
    : `Bearer ${X_USER_ACCESS_TOKEN}`;

  let response;
  try {
    response = await fetch(postUrl, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(X_TIMEOUT_MS)
    });
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      throw new PublishRequestError("timeout", "x publish timeout", { retryable: true });
    }
    throw new PublishRequestError("provider_unavailable", "x publish request failed", { retryable: true });
  }

  const raw = await response.text();
  if (!response.ok) {
    throw new PublishRequestError(toErrorCodeFromHttp(response.status), `x publish http ${response.status}`, {
      retryable: response.status >= 500 || response.status === 429,
      httpStatus: response.status,
      rawBody: raw
    });
  }

  const body = safeJsonParse(raw, {});
  const externalPostId = pickFirstString([body?.data?.id, body?.id]);
  if (!externalPostId) {
    throw new PublishRequestError("unknown", "x publish response missing data.id", {
      retryable: false,
      rawBody: raw
    });
  }

  return {
    channel: "x",
    externalPostId,
    postUrl: `https://x.com/i/web/status/${externalPostId}`,
    rawResponseJson: raw
  };
}

async function publish(content) {
  const channel = String(content.channel || "").trim().toLowerCase();
  if (channel === "x") {
    return publishToX(content);
  }
  throw new PublishRequestError("bad_request", `unsupported_channel:${channel || "unknown"}`, {
    retryable: false
  });
}

async function claimQueuedJobs(db) {
  return db.all(
    `SELECT id, content_id, channel, scheduled_at, status,
            attempt_count, next_attempt_at, created_at
     FROM marketing_publish_jobs
     WHERE status = 'queued'
       AND scheduled_at <= ?
       AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
     ORDER BY created_at ASC
     LIMIT ?`,
    [nowIso(), nowIso(), BATCH_SIZE]
  );
}

async function markProcessing(db, job) {
  return db.run(
    `UPDATE marketing_publish_jobs
     SET status = 'processing',
         updated_at = ?,
         last_error = NULL
     WHERE id = ? AND status = 'queued'`,
    [nowIso(), job.id]
  );
}

async function markSucceeded(db, job, result) {
  const now = nowIso();
  await db.run(
    `UPDATE marketing_publish_jobs
     SET status = 'succeeded',
         attempt_count = ?,
         next_attempt_at = NULL,
         last_error = NULL,
         updated_at = ?
     WHERE id = ?`,
    [Number(job.attempt_count || 0) + 1, now, job.id]
  );
  await db.run(
    `UPDATE marketing_contents
     SET status = 'posted',
         updated_at = ?
     WHERE id = ?`,
    [now, job.content_id]
  );
  await db.run(
    `INSERT INTO marketing_posts (
       id, content_id, channel, external_post_id, post_url, published_at, raw_response_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      crypto.randomUUID(),
      job.content_id,
      result.channel,
      result.externalPostId,
      result.postUrl || null,
      now,
      result.rawResponseJson || null
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
    `UPDATE marketing_publish_jobs
     SET status = ?,
         attempt_count = ?,
         next_attempt_at = ?,
         last_error = ?,
         updated_at = ?
     WHERE id = ?`,
    [
      retryable ? "queued" : "failed",
      attemptCount,
      nextAttemptAt,
      `${code}:${message}`,
      now,
      job.id
    ]
  );
}

async function processJob(db, job) {
  const claimed = await markProcessing(db, job);
  if (claimed < 1) return;

  try {
    const content = await db.get(
      `SELECT id, channel, title, body_text, hashtags_json, media_asset_url
       FROM marketing_contents
       WHERE id = ?`,
      [job.content_id]
    );
    if (!content) {
      throw new PublishRequestError("bad_request", "content_not_found", { retryable: false });
    }
    const result = await publish(content);
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
    console.log("marketing publish worker is disabled (MARKETING_PUBLISH_WORKER_ENABLED!=true)");
    return;
  }
  if (!isPublisherConfigured()) {
    console.log("marketing publish worker skipped: publisher env is not configured");
    return;
  }
  if (!EXECUTE_PLACEHOLDER) {
    console.log(
      "marketing publish worker is in safe mode (set MARKETING_PUBLISH_PLACEHOLDER_EXECUTE=true to run publisher execution)"
    );
    return;
  }

  const db = buildDb();
  try {
    await ensurePublishTables(db);
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
  console.error("marketing publish worker failed", error);
  process.exit(1);
});
