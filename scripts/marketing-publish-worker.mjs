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
const X_MEDIA_UPLOAD_BASE_URL =
  (process.env.MARKETING_X_MEDIA_UPLOAD_BASE_URL || "https://upload.twitter.com").trim().replace(/\/$/, "");
const X_USER_ACCESS_TOKEN = (process.env.MARKETING_X_USER_ACCESS_TOKEN || "").trim();
const X_USER_ACCESS_TOKEN_SECRET = (process.env.MARKETING_X_USER_ACCESS_TOKEN_SECRET || "").trim();
const X_API_KEY = (process.env.MARKETING_X_API_KEY || "").trim();
const X_API_SECRET = (process.env.MARKETING_X_API_SECRET || "").trim();
const X_TIMEOUT_MS = Number(process.env.MARKETING_X_TIMEOUT_MS || 30000);
const X_MEDIA_CHUNK_SIZE = Number(process.env.MARKETING_X_MEDIA_CHUNK_SIZE || 4 * 1024 * 1024);
const X_MEDIA_PROCESSING_TIMEOUT_MS = Number(process.env.MARKETING_X_MEDIA_PROCESSING_TIMEOUT_MS || 300000);
const TIKTOK_POSTS_BASE_URL = (process.env.MARKETING_TIKTOK_POSTS_BASE_URL || "https://open.tiktokapis.com")
  .trim()
  .replace(/\/$/, "");
const TIKTOK_USER_ACCESS_TOKEN = (process.env.MARKETING_TIKTOK_USER_ACCESS_TOKEN || "").trim();
const TIKTOK_TIMEOUT_MS = Number(process.env.MARKETING_TIKTOK_TIMEOUT_MS || 30000);
const MARKETING_ALERT_EMAIL = (process.env.MARKETING_ALERT_EMAIL || "tetubrah@gmail.com").trim();

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
    if (typeof item === "string" && item.trim()) return item.trim();
  }
  return null;
}

function pickFirstNumber(candidates) {
  for (const item of candidates) {
    const n = Number(item);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function nextBackoffSeconds(attemptCount) {
  const schedule = [30, 120, 600, 1800, 7200];
  return schedule[Math.min(attemptCount, schedule.length - 1)];
}

async function queueAlertEmail(db, subject, bodyText) {
  if (!MARKETING_ALERT_EMAIL) return;
  const createdAt = nowIso();
  await db.run(
    `INSERT INTO email_deliveries
     (id, event_id, to_email, template_key, subject, body_text, status, attempt_count, next_attempt_at, provider_message_id, last_error, created_at, updated_at, sent_at)
     VALUES (?, NULL, ?, 'marketing_alert', ?, ?, 'queued', 0, ?, NULL, NULL, ?, ?, NULL)`,
    [crypto.randomUUID(), MARKETING_ALERT_EMAIL, subject, bodyText, createdAt, createdAt, createdAt]
  );
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
    `CREATE TABLE IF NOT EXISTS email_deliveries (
      id TEXT PRIMARY KEY,
      event_id TEXT,
      to_email TEXT NOT NULL,
      template_key TEXT NOT NULL,
      subject TEXT NOT NULL,
      body_text TEXT NOT NULL,
      status TEXT NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TEXT,
      provider_message_id TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      sent_at TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS marketing_publish_jobs_status_next_attempt_idx
      ON marketing_publish_jobs (status, next_attempt_at)`
  ];
  for (const sql of statements) {
    await db.run(sql);
  }
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

function isXPublisherConfigured() {
  return isOAuth1Configured() || isOAuth2BearerConfigured();
}

function isTikTokPublisherConfigured() {
  return Boolean(TIKTOK_USER_ACCESS_TOKEN);
}

function isAnyPublisherConfigured() {
  return isXPublisherConfigured() || isTikTokPublisherConfigured();
}

function percentEncode(input) {
  return encodeURIComponent(String(input)).replace(/[!'()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
}

function buildOAuth1Header(method, requestUrl) {
  const oauthParams = {
    oauth_consumer_key: X_API_KEY,
    oauth_nonce: crypto.randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: `${Math.floor(Date.now() / 1000)}`,
    oauth_token: X_USER_ACCESS_TOKEN,
    oauth_version: "1.0"
  };

  const parsed = new URL(requestUrl);
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

async function xRequest(method, url, body = null, contentType = null, oauth1Only = false) {
  if (oauth1Only && !isOAuth1Configured()) {
    throw new PublishRequestError("bad_request", "x media upload requires oauth1 user context", {
      retryable: false
    });
  }

  const headers = {};
  if (isOAuth1Configured()) {
    headers.Authorization = buildOAuth1Header(method, url);
  } else {
    headers.Authorization = `Bearer ${X_USER_ACCESS_TOKEN}`;
  }
  if (contentType) {
    headers["Content-Type"] = contentType;
  }

  let response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(X_TIMEOUT_MS)
    });
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      throw new PublishRequestError("timeout", "x request timeout", { retryable: true });
    }
    throw new PublishRequestError("provider_unavailable", "x request failed", { retryable: true });
  }

  const raw = await response.text();
  return { response, raw };
}

function detectMimeType(mediaUrl, responseMimeType) {
  const fromResponse = String(responseMimeType || "").trim().toLowerCase();
  if (fromResponse && fromResponse !== "application/octet-stream") return fromResponse;
  const lower = String(mediaUrl || "").toLowerCase();
  if (lower.includes(".mp4")) return "video/mp4";
  if (lower.includes(".mov")) return "video/quicktime";
  if (lower.includes(".webm")) return "video/webm";
  return "video/mp4";
}

async function fetchMediaBinary(mediaUrl) {
  let response;
  try {
    response = await fetch(mediaUrl, {
      method: "GET",
      signal: AbortSignal.timeout(X_TIMEOUT_MS)
    });
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      throw new PublishRequestError("timeout", "media download timeout", { retryable: true });
    }
    throw new PublishRequestError("provider_unavailable", "media download request failed", {
      retryable: true
    });
  }

  if (!response.ok) {
    throw new PublishRequestError(
      toErrorCodeFromHttp(response.status),
      `media download http ${response.status}`,
      {
        retryable: response.status >= 500 || response.status === 429
      }
    );
  }

  const mimeType = detectMimeType(mediaUrl, response.headers.get("content-type"));
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength < 1) {
    throw new PublishRequestError("bad_request", "media download is empty", { retryable: false });
  }
  return { bytes, mimeType };
}

async function uploadVideoToX(mediaUrl) {
  const media = await fetchMediaBinary(mediaUrl);
  const totalBytes = media.bytes.byteLength;
  const initUrl =
    `${X_MEDIA_UPLOAD_BASE_URL}/1.1/media/upload.json` +
    `?command=INIT&total_bytes=${encodeURIComponent(totalBytes)}` +
    `&media_type=${encodeURIComponent(media.mimeType)}` +
    `&media_category=tweet_video`;

  const init = await xRequest("POST", initUrl, null, null, true);
  if (!init.response.ok) {
    throw new PublishRequestError(toErrorCodeFromHttp(init.response.status), `x media init http ${init.response.status}`, {
      retryable: init.response.status >= 500 || init.response.status === 429,
      rawBody: init.raw
    });
  }

  const initBody = safeJsonParse(init.raw, {});
  const mediaId = pickFirstString([initBody?.media_id_string, initBody?.media_id]);
  if (!mediaId) {
    throw new PublishRequestError("unknown", "x media init missing media_id", {
      retryable: false,
      rawBody: init.raw
    });
  }

  const chunkSize = Math.max(256 * 1024, X_MEDIA_CHUNK_SIZE);
  const totalChunks = Math.ceil(totalBytes / chunkSize);
  for (let i = 0; i < totalChunks; i += 1) {
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, totalBytes);
    const chunk = media.bytes.slice(start, end);

    const form = new FormData();
    form.append("media", new Blob([chunk], { type: media.mimeType }), "video.mp4");

    const appendUrl =
      `${X_MEDIA_UPLOAD_BASE_URL}/1.1/media/upload.json` +
      `?command=APPEND&media_id=${encodeURIComponent(mediaId)}` +
      `&segment_index=${encodeURIComponent(i)}`;

    const append = await xRequest("POST", appendUrl, form, null, true);
    if (!append.response.ok) {
      throw new PublishRequestError(
        toErrorCodeFromHttp(append.response.status),
        `x media append http ${append.response.status}`,
        {
          retryable: append.response.status >= 500 || append.response.status === 429,
          rawBody: append.raw
        }
      );
    }
  }

  const finalizeUrl =
    `${X_MEDIA_UPLOAD_BASE_URL}/1.1/media/upload.json` +
    `?command=FINALIZE&media_id=${encodeURIComponent(mediaId)}`;
  const finalize = await xRequest("POST", finalizeUrl, null, null, true);
  if (!finalize.response.ok) {
    throw new PublishRequestError(
      toErrorCodeFromHttp(finalize.response.status),
      `x media finalize http ${finalize.response.status}`,
      {
        retryable: finalize.response.status >= 500 || finalize.response.status === 429,
        rawBody: finalize.raw
      }
    );
  }

  let statusBody = safeJsonParse(finalize.raw, {});
  let state = String(statusBody?.processing_info?.state || "").toLowerCase();
  const startedAt = Date.now();

  while (state && state !== "succeeded") {
    if (state === "failed") {
      throw new PublishRequestError("bad_request", "x media processing failed", {
        retryable: false,
        rawBody: safeJsonStringify(statusBody)
      });
    }
    if (Date.now() - startedAt > X_MEDIA_PROCESSING_TIMEOUT_MS) {
      throw new PublishRequestError("timeout", "x media processing timeout", { retryable: true });
    }

    const waitSec = Math.max(1, pickFirstNumber([statusBody?.processing_info?.check_after_secs]) || 5);
    await new Promise((resolve) => setTimeout(resolve, waitSec * 1000));

    const statusUrl =
      `${X_MEDIA_UPLOAD_BASE_URL}/1.1/media/upload.json` +
      `?command=STATUS&media_id=${encodeURIComponent(mediaId)}`;
    const statusResp = await xRequest("GET", statusUrl, null, null, true);
    if (!statusResp.response.ok) {
      throw new PublishRequestError(
        toErrorCodeFromHttp(statusResp.response.status),
        `x media status http ${statusResp.response.status}`,
        {
          retryable: statusResp.response.status >= 500 || statusResp.response.status === 429,
          rawBody: statusResp.raw
        }
      );
    }

    statusBody = safeJsonParse(statusResp.raw, {});
    state = String(statusBody?.processing_info?.state || "succeeded").toLowerCase();
  }

  return {
    mediaId,
    rawResponseJson: safeJsonStringify(statusBody)
  };
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
  if (!isXPublisherConfigured()) {
    throw new PublishRequestError("bad_request", "x auth env is missing", {
      retryable: false
    });
  }

  const text = buildXText(content);
  const mediaUrl = pickFirstString([content?.media_asset_url]);
  let media = null;
  if (mediaUrl) {
    media = await uploadVideoToX(mediaUrl);
  }

  const payload = media ? { text, media: { media_ids: [media.mediaId] } } : { text };
  const postUrl = `${X_POSTS_BASE_URL}/2/tweets`;
  const posted = await xRequest("POST", postUrl, JSON.stringify(payload), "application/json", false);

  if (!posted.response.ok) {
    throw new PublishRequestError(toErrorCodeFromHttp(posted.response.status), `x publish http ${posted.response.status}`, {
      retryable: posted.response.status >= 500 || posted.response.status === 429,
      httpStatus: posted.response.status,
      rawBody: posted.raw
    });
  }

  const body = safeJsonParse(posted.raw, {});
  const externalPostId = pickFirstString([body?.data?.id, body?.id]);
  if (!externalPostId) {
    throw new PublishRequestError("unknown", "x publish response missing data.id", {
      retryable: false,
      rawBody: posted.raw
    });
  }

  return {
    channel: "x",
    externalPostId,
    postUrl: `https://x.com/i/web/status/${externalPostId}`,
    rawResponseJson: safeJsonStringify({
      tweet: body,
      media: media?.rawResponseJson ? safeJsonParse(media.rawResponseJson, media.rawResponseJson) : null
    })
  };
}

function toErrorCodeFromTikTokApi(errorCode) {
  const code = String(errorCode || "").trim().toLowerCase();
  if (!code || code === "ok") return "unknown";
  if (code === "rate_limit_exceeded") return "rate_limited";
  if (code === "access_token_invalid" || code === "scope_not_authorized") return "unauthorized";
  if (code === "invalid_param" || code === "url_ownership_unverified") return "bad_request";
  if (code.startsWith("spam_risk_")) return "bad_request";
  return "unknown";
}

function isTikTokRetryableError(errorCode, httpStatus) {
  const code = String(errorCode || "").trim().toLowerCase();
  if (code === "rate_limit_exceeded") return true;
  if (httpStatus === 429) return true;
  if (httpStatus >= 500) return true;
  return false;
}

async function tiktokRequest(method, url, body = null) {
  if (!isTikTokPublisherConfigured()) {
    throw new PublishRequestError("bad_request", "tiktok auth env is missing", {
      retryable: false
    });
  }

  let response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${TIKTOK_USER_ACCESS_TOKEN}`,
        "Content-Type": "application/json; charset=UTF-8"
      },
      body,
      signal: AbortSignal.timeout(TIKTOK_TIMEOUT_MS)
    });
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      throw new PublishRequestError("timeout", "tiktok request timeout", { retryable: true });
    }
    throw new PublishRequestError("provider_unavailable", "tiktok request failed", { retryable: true });
  }

  const raw = await response.text();
  return { response, raw };
}

async function publishToTikTok(content) {
  if (!isTikTokPublisherConfigured()) {
    throw new PublishRequestError("bad_request", "tiktok auth env is missing", {
      retryable: false
    });
  }

  const mediaUrl = pickFirstString([content?.media_asset_url]);
  if (!mediaUrl) {
    throw new PublishRequestError("bad_request", "tiktok requires media_asset_url", {
      retryable: false
    });
  }

  const initUrl = `${TIKTOK_POSTS_BASE_URL}/v2/post/publish/inbox/video/init/`;
  const payload = {
    source_info: {
      source: "PULL_FROM_URL",
      video_url: mediaUrl
    }
  };

  const initialized = await tiktokRequest("POST", initUrl, JSON.stringify(payload));
  const body = safeJsonParse(initialized.raw, {});
  const apiCode = String(body?.error?.code || "").trim().toLowerCase();

  if (!initialized.response.ok || (apiCode && apiCode !== "ok")) {
    throw new PublishRequestError(
      apiCode ? toErrorCodeFromTikTokApi(apiCode) : toErrorCodeFromHttp(initialized.response.status),
      `tiktok publish init failed: ${apiCode || initialized.response.status}`,
      {
        retryable: isTikTokRetryableError(apiCode, initialized.response.status),
        httpStatus: initialized.response.status,
        rawBody: initialized.raw
      }
    );
  }

  const publishId = pickFirstString([body?.data?.publish_id]);
  if (!publishId) {
    throw new PublishRequestError("unknown", "tiktok publish response missing publish_id", {
      retryable: false,
      rawBody: initialized.raw
    });
  }

  return {
    channel: "tiktok",
    externalPostId: publishId,
    postUrl: null,
    rawResponseJson: safeJsonStringify(body)
  };
}

async function publish(content) {
  const channel = String(content.channel || "").trim().toLowerCase();
  if (channel === "x") {
    return publishToX(content);
  }
  if (channel === "tiktok") {
    return publishToTikTok(content);
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

  if (!retryable) {
    await queueAlertEmail(
      db,
      `[Marketing][Publish Failed] content:${job.content_id}`,
      [
        `job_id=${job.id}`,
        `content_id=${job.content_id}`,
        `code=${code}`,
        `message=${message}`,
        `attempt_count=${attemptCount}`,
        `at=${now}`
      ].join("\n")
    );
  }
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
    const result = await publish({ ...content, channel: job.channel || content.channel });
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
  if (!isAnyPublisherConfigured()) {
    console.log("marketing publish worker skipped: publisher env is not configured for x or tiktok");
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
