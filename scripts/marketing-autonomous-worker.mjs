import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import Database from "better-sqlite3";
import pg from "pg";

const { Pool } = pg;

const DB_PATH = path.join(process.cwd(), "data", "app.db");
const DATABASE_URL = (process.env.DATABASE_URL || "").trim();

const WORKER_ENABLED = process.env.MARKETING_AUTONOMOUS_WORKER_ENABLED === "true";
const EXECUTE_PLACEHOLDER = process.env.MARKETING_AUTONOMOUS_PLACEHOLDER_EXECUTE === "true";
const CONTINUOUS = process.env.MARKETING_AUTONOMOUS_WORKER_CONTINUOUS === "true";
const POLL_INTERVAL_MS = Number(process.env.MARKETING_AUTONOMOUS_WORKER_POLL_MS || 300000);
const IDENTITY_ID = (process.env.MARKETING_AUTONOMOUS_IDENTITY_ID || "koyuki").trim();
const IDENTITY_DISPLAY_NAME = (process.env.MARKETING_AUTONOMOUS_DISPLAY_NAME || "小雪").trim();
const TIMEZONE = (process.env.MARKETING_AUTONOMOUS_TIMEZONE || "Asia/Tokyo").trim();
const DAILY_POST_LIMIT = Math.max(1, Number(process.env.MARKETING_AUTONOMOUS_DAILY_POST_LIMIT || 3));
const MIN_INTERVAL_MINUTES = Math.max(5, Number(process.env.MARKETING_AUTONOMOUS_MIN_INTERVAL_MINUTES || 120));
const ACTIVE_HOUR_START = clamp(Number(process.env.MARKETING_AUTONOMOUS_ACTIVE_HOUR_START || 8), 0, 23);
const ACTIVE_HOUR_END = clamp(Number(process.env.MARKETING_AUTONOMOUS_ACTIVE_HOUR_END || 23), 1, 24);
const METRICS_FETCH_LIMIT = clamp(Number(process.env.MARKETING_AUTONOMOUS_METRICS_FETCH_LIMIT || 20), 1, 100);
const REQUIRE_X_AUTH = process.env.MARKETING_AUTONOMOUS_REQUIRE_X_AUTH !== "false";

const X_POSTS_BASE_URL = (process.env.MARKETING_X_POSTS_BASE_URL || "https://api.x.com").trim().replace(/\/$/, "");
const X_USER_ACCESS_TOKEN = (process.env.MARKETING_X_USER_ACCESS_TOKEN || "").trim();
const X_USER_ACCESS_TOKEN_SECRET = (process.env.MARKETING_X_USER_ACCESS_TOKEN_SECRET || "").trim();
const X_API_KEY = (process.env.MARKETING_X_API_KEY || "").trim();
const X_API_SECRET = (process.env.MARKETING_X_API_SECRET || "").trim();
const X_TIMEOUT_MS = Number(process.env.MARKETING_X_TIMEOUT_MS || 30000);

const DEFAULT_TOPICS = [
  "AI運用",
  "業務改善",
  "マーケティング実務",
  "チームの生産性",
  "小さな検証の積み上げ",
  "データと感性の両立"
];
const TOPICS = parseCsv(process.env.MARKETING_AUTONOMOUS_TOPICS || "").length
  ? parseCsv(process.env.MARKETING_AUTONOMOUS_TOPICS || "")
  : DEFAULT_TOPICS;

const DEFAULT_HASHTAGS = ["#AI活用", "#マーケティング", "#業務改善", "#Sinkai"];
const BASE_HASHTAGS = parseCsv(process.env.MARKETING_AUTONOMOUS_BASE_HASHTAGS || "").length
  ? parseCsv(process.env.MARKETING_AUTONOMOUS_BASE_HASHTAGS || "").map(normalizeHashtag).filter(Boolean)
  : DEFAULT_HASHTAGS;

class AutonomousError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = "AutonomousError";
    this.code = code;
    this.retryable = Boolean(options.retryable);
    this.httpStatus = options.httpStatus ?? null;
    this.rawBody = options.rawBody ?? null;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function parseCsv(value) {
  return String(value || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
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

function pickFirstNumber(values, fallback = 0) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function pickRandom(values, fallback = "") {
  if (!Array.isArray(values) || values.length < 1) return fallback;
  return values[crypto.randomInt(values.length)] || fallback;
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

async function ensureTables(db) {
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
    `CREATE TABLE IF NOT EXISTS marketing_metrics_daily (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL,
      metric_date TEXT NOT NULL,
      impressions INTEGER NOT NULL DEFAULT 0,
      engagements INTEGER NOT NULL DEFAULT 0,
      clicks INTEGER NOT NULL DEFAULT 0,
      profile_visits INTEGER NOT NULL DEFAULT 0,
      conversions INTEGER NOT NULL DEFAULT 0,
      cost_jpy INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS marketing_metrics_daily_post_date_idx
      ON marketing_metrics_daily (post_id, metric_date)`,
    `CREATE TABLE IF NOT EXISTS marketing_identity_profiles (
      id TEXT PRIMARY KEY,
      channel TEXT NOT NULL,
      display_name TEXT NOT NULL,
      identity_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`
  ];
  for (const sql of statements) {
    await db.run(sql);
  }
}

function isOAuth1Configured() {
  return Boolean(X_API_KEY) && Boolean(X_API_SECRET) && Boolean(X_USER_ACCESS_TOKEN) && Boolean(X_USER_ACCESS_TOKEN_SECRET);
}

function isOAuth2BearerConfigured() {
  return Boolean(X_USER_ACCESS_TOKEN);
}

function isXMetricsConfigured() {
  return isOAuth1Configured() || isOAuth2BearerConfigured();
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

async function xRequest(method, url) {
  const headers = {};
  if (isOAuth1Configured()) {
    headers.Authorization = buildOAuth1Header(method, url);
  } else if (isOAuth2BearerConfigured()) {
    headers.Authorization = `Bearer ${X_USER_ACCESS_TOKEN}`;
  } else {
    throw new AutonomousError("bad_request", "x auth env is missing", { retryable: false });
  }

  let response;
  try {
    response = await fetch(url, {
      method,
      headers,
      signal: AbortSignal.timeout(X_TIMEOUT_MS)
    });
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      throw new AutonomousError("timeout", "x metrics timeout", { retryable: true });
    }
    throw new AutonomousError("provider_unavailable", "x metrics request failed", { retryable: true });
  }

  const raw = await response.text();
  return { response, raw };
}

function normalizeHashtag(value) {
  const word = String(value || "")
    .replace(/[#＃]/g, "")
    .replace(/[^\p{L}\p{N}_]/gu, "")
    .slice(0, 30);
  if (!word) return "";
  return `#${word}`;
}

function dateKeyInTz(isoString, timeZone) {
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return "";
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const parts = formatter.formatToParts(d);
  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  return `${year}-${month}-${day}`;
}

function hourInTz(isoString, timeZone) {
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return 0;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    hour: "2-digit"
  });
  return Number(formatter.format(d));
}

function withinActiveHours(now, timeZone) {
  const hour = hourInTz(now, timeZone);
  if (ACTIVE_HOUR_START < ACTIVE_HOUR_END) {
    return hour >= ACTIVE_HOUR_START && hour < ACTIVE_HOUR_END;
  }
  return hour >= ACTIVE_HOUR_START || hour < ACTIVE_HOUR_END;
}

function defaultIdentity() {
  return {
    version: 1,
    core: {
      name: IDENTITY_DISPLAY_NAME,
      role: "Sinkai marketer",
      tone: "friendly-data-driven"
    },
    pillars: ["AI活用", "業務改善", "マーケ実務", "小さな検証"],
    style: {
      opener: [
        "おはようございます。小雪です。",
        "小雪です。今日の気づきを1つ。",
        "現場で効いた小ネタを共有します。"
      ],
      closer: [
        "まずは小さく1つ試してみましょう。",
        "数字で見て、次の一手を決めましょう。",
        "明日から使える形で残していきます。"
      ],
      emoji: ["🌸", "📈", "✨"]
    },
    hashtag_pool: BASE_HASHTAGS,
    adaptation: {
      sample_size: 0,
      winning_hashtags: [],
      winning_patterns: [],
      avoid_patterns: [],
      summary: "baseline"
    },
    memory: {
      recent_topic_keys: [],
      recent_text_hashes: []
    }
  };
}

async function getIdentityProfile(db) {
  const row = await db.get(
    `SELECT id, channel, display_name, identity_json, created_at, updated_at
     FROM marketing_identity_profiles
     WHERE id = ?`,
    [IDENTITY_ID]
  );

  if (row?.identity_json) {
    return {
      id: row.id,
      channel: row.channel,
      display_name: row.display_name,
      created_at: row.created_at,
      updated_at: row.updated_at,
      identity: safeJsonParse(row.identity_json, defaultIdentity())
    };
  }

  const now = nowIso();
  const identity = defaultIdentity();
  await db.run(
    `INSERT INTO marketing_identity_profiles (
      id, channel, display_name, identity_json, created_at, updated_at
    ) VALUES (?, 'x', ?, ?, ?, ?)`,
    [IDENTITY_ID, IDENTITY_DISPLAY_NAME, safeJsonStringify(identity) || "{}", now, now]
  );

  return {
    id: IDENTITY_ID,
    channel: "x",
    display_name: IDENTITY_DISPLAY_NAME,
    created_at: now,
    updated_at: now,
    identity
  };
}

async function saveIdentityProfile(db, profile) {
  const now = nowIso();
  await db.run(
    `UPDATE marketing_identity_profiles
     SET identity_json = ?,
         updated_at = ?
     WHERE id = ?`,
    [safeJsonStringify(profile.identity) || "{}", now, profile.id]
  );
  profile.updated_at = now;
}

function parseHashtags(raw) {
  const parsed = safeJsonParse(raw, []);
  if (!Array.isArray(parsed)) return [];
  return parsed.map(normalizeHashtag).filter(Boolean).slice(0, 10);
}

function extractTextPatterns(text) {
  const body = String(text || "").trim();
  if (!body) return [];
  const patterns = [];
  if (/[？?]/.test(body)) patterns.push("question");
  if (/\n[-・]/.test(body)) patterns.push("bullet");
  if (/[0-9０-９]/.test(body)) patterns.push("number");
  if (/\p{Extended_Pictographic}/u.test(body)) patterns.push("emoji");
  if (body.length <= 120) patterns.push("short");
  if (body.length >= 220) patterns.push("long");
  return patterns;
}

function scorePost(metrics) {
  const impressions = Math.max(1, Number(metrics.impressions || 0));
  const engagements = Number(metrics.engagements || 0);
  const clicks = Number(metrics.clicks || 0);
  const profileVisits = Number(metrics.profile_visits || 0);
  const normalized = engagements / impressions + (clicks * 2 + profileVisits * 1.5) / impressions;
  return normalized + engagements * 0.005;
}

function upsertCounter(map, key, step = 1) {
  if (!key) return;
  map.set(key, (map.get(key) || 0) + step);
}

function topKeys(counter, limit = 5) {
  return Array.from(counter.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([k]) => k);
}

function buildAdaptation(profileIdentity, samples) {
  if (!Array.isArray(samples) || samples.length < 3) {
    return {
      ...profileIdentity.adaptation,
      sample_size: Array.isArray(samples) ? samples.length : 0,
      summary: "insufficient_reaction_data"
    };
  }

  const scored = samples
    .map((sample) => ({
      ...sample,
      score: scorePost(sample)
    }))
    .sort((a, b) => b.score - a.score);

  const top = scored.slice(0, Math.max(1, Math.floor(scored.length * 0.35)));
  const bottom = scored.slice(-Math.max(1, Math.floor(scored.length * 0.35)));

  const topHashtags = new Map();
  const bottomHashtags = new Map();
  const topPatterns = new Map();
  const bottomPatterns = new Map();

  for (const row of top) {
    for (const tag of row.hashtags || []) upsertCounter(topHashtags, tag, 1);
    for (const pattern of row.patterns || []) upsertCounter(topPatterns, pattern, 1);
  }

  for (const row of bottom) {
    for (const tag of row.hashtags || []) upsertCounter(bottomHashtags, tag, 1);
    for (const pattern of row.patterns || []) upsertCounter(bottomPatterns, pattern, 1);
  }

  const winningHashtags = topKeys(topHashtags, 5);
  const winningPatterns = topKeys(topPatterns, 5).filter((pattern) => {
    return (topPatterns.get(pattern) || 0) > (bottomPatterns.get(pattern) || 0);
  });
  const avoidPatterns = topKeys(bottomPatterns, 5).filter((pattern) => {
    return (bottomPatterns.get(pattern) || 0) > (topPatterns.get(pattern) || 0);
  });

  const summaryParts = [];
  if (winningHashtags.length) summaryParts.push(`winning_tags=${winningHashtags.join("|")}`);
  if (winningPatterns.length) summaryParts.push(`winning_patterns=${winningPatterns.join("|")}`);
  if (avoidPatterns.length) summaryParts.push(`avoid_patterns=${avoidPatterns.join("|")}`);

  return {
    sample_size: samples.length,
    winning_hashtags: winningHashtags,
    winning_patterns: winningPatterns,
    avoid_patterns: avoidPatterns,
    summary: summaryParts.join("; ") || "updated"
  };
}

async function getReactionSamples(db) {
  const rows = await db.all(
    `SELECT p.id AS post_id,
            p.published_at,
            c.body_text,
            c.hashtags_json,
            m.impressions,
            m.engagements,
            m.clicks,
            m.profile_visits
     FROM marketing_posts p
     LEFT JOIN marketing_contents c ON c.id = p.content_id
     LEFT JOIN marketing_metrics_daily m
       ON m.id = (
         SELECT mm.id
         FROM marketing_metrics_daily mm
         WHERE mm.post_id = p.id
         ORDER BY mm.metric_date DESC, mm.updated_at DESC
         LIMIT 1
       )
     WHERE p.channel = 'x'
     ORDER BY p.published_at DESC
     LIMIT 40`
  );

  return rows.map((row) => ({
    post_id: row.post_id,
    published_at: row.published_at,
    body_text: String(row.body_text || ""),
    hashtags: parseHashtags(row.hashtags_json),
    patterns: extractTextPatterns(row.body_text),
    impressions: pickFirstNumber([row.impressions], 0),
    engagements: pickFirstNumber([row.engagements], 0),
    clicks: pickFirstNumber([row.clicks], 0),
    profile_visits: pickFirstNumber([row.profile_visits], 0)
  }));
}

async function fetchTweetMetricsByExternalId(externalPostId) {
  const baseFields = "public_metrics,non_public_metrics,organic_metrics";
  const primaryUrl = `${X_POSTS_BASE_URL}/2/tweets/${encodeURIComponent(externalPostId)}?tweet.fields=${encodeURIComponent(baseFields)}`;
  let response = await xRequest("GET", primaryUrl);

  if (!response.response.ok && (response.response.status === 401 || response.response.status === 403)) {
    const fallbackUrl = `${X_POSTS_BASE_URL}/2/tweets/${encodeURIComponent(externalPostId)}?tweet.fields=public_metrics`;
    response = await xRequest("GET", fallbackUrl);
  }

  if (!response.response.ok) {
    throw new AutonomousError("x_http_error", `x metrics http ${response.response.status}`, {
      retryable: response.response.status >= 500 || response.response.status === 429,
      httpStatus: response.response.status,
      rawBody: response.raw
    });
  }

  const body = safeJsonParse(response.raw, {});
  const data = body?.data;
  if (!data || typeof data !== "object") {
    throw new AutonomousError("x_metrics_missing", "x metrics response missing data", {
      retryable: false,
      rawBody: response.raw
    });
  }

  const publicMetrics = data.public_metrics || {};
  const nonPublicMetrics = data.non_public_metrics || {};
  const organicMetrics = data.organic_metrics || {};

  const impressions = pickFirstNumber(
    [
      nonPublicMetrics.impression_count,
      organicMetrics.impression_count,
      publicMetrics.impression_count,
      0
    ],
    0
  );

  const engagements =
    pickFirstNumber([publicMetrics.like_count], 0) +
    pickFirstNumber([publicMetrics.reply_count], 0) +
    pickFirstNumber([publicMetrics.retweet_count], 0) +
    pickFirstNumber([publicMetrics.quote_count], 0) +
    pickFirstNumber([publicMetrics.bookmark_count], 0);

  const clicks = pickFirstNumber(
    [
      nonPublicMetrics.url_link_clicks,
      organicMetrics.url_link_clicks,
      nonPublicMetrics.user_profile_clicks,
      organicMetrics.user_profile_clicks,
      0
    ],
    0
  );

  const profileVisits = pickFirstNumber(
    [
      nonPublicMetrics.user_profile_clicks,
      organicMetrics.user_profile_clicks,
      0
    ],
    0
  );

  return {
    impressions,
    engagements,
    clicks,
    profile_visits: profileVisits
  };
}

async function upsertDailyMetrics(db, postId, metricDate, metrics) {
  const now = nowIso();
  const id = crypto.randomUUID();
  await db.run(
    `INSERT INTO marketing_metrics_daily (
      id, post_id, metric_date, impressions, engagements, clicks,
      profile_visits, conversions, cost_jpy, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)
    ON CONFLICT(post_id, metric_date)
    DO UPDATE SET
      impressions = excluded.impressions,
      engagements = excluded.engagements,
      clicks = excluded.clicks,
      profile_visits = excluded.profile_visits,
      updated_at = excluded.updated_at`,
    [
      id,
      postId,
      metricDate,
      Math.max(0, Math.trunc(metrics.impressions || 0)),
      Math.max(0, Math.trunc(metrics.engagements || 0)),
      Math.max(0, Math.trunc(metrics.clicks || 0)),
      Math.max(0, Math.trunc(metrics.profile_visits || 0)),
      now,
      now
    ]
  );
}

async function syncRecentMetrics(db) {
  if (!isXMetricsConfigured()) {
    return {
      fetched: 0,
      updated: 0,
      skipped: 0,
      reason: "x_auth_not_configured"
    };
  }

  const posts = await db.all(
    `SELECT id, external_post_id
     FROM marketing_posts
     WHERE channel = 'x'
     ORDER BY published_at DESC
     LIMIT ?`,
    [METRICS_FETCH_LIMIT]
  );

  const metricDate = dateKeyInTz(nowIso(), TIMEZONE);
  let updated = 0;
  let skipped = 0;

  for (const row of posts) {
    const externalPostId = String(row.external_post_id || "").trim();
    if (!externalPostId) {
      skipped += 1;
      continue;
    }

    try {
      const metrics = await fetchTweetMetricsByExternalId(externalPostId);
      await upsertDailyMetrics(db, row.id, metricDate, metrics);
      updated += 1;
    } catch (error) {
      if (error?.httpStatus === 429) {
        break;
      }
      skipped += 1;
    }
  }

  return {
    fetched: posts.length,
    updated,
    skipped,
    reason: null
  };
}

function mergeIdentityWithAdaptation(identity, adaptation) {
  const next = {
    ...identity,
    adaptation,
    hashtag_pool: [
      ...adaptation.winning_hashtags,
      ...BASE_HASHTAGS,
      ...(Array.isArray(identity.hashtag_pool) ? identity.hashtag_pool : [])
    ]
      .map(normalizeHashtag)
      .filter(Boolean)
      .filter((v, idx, arr) => arr.indexOf(v) === idx)
      .slice(0, 8)
  };
  return next;
}

function shouldUseQuestion(adaptation) {
  return Array.isArray(adaptation?.winning_patterns) && adaptation.winning_patterns.includes("question");
}

function shouldUseNumber(adaptation) {
  return Array.isArray(adaptation?.winning_patterns) && adaptation.winning_patterns.includes("number");
}

function nextRecentList(values, nextValue, max = 20) {
  const current = Array.isArray(values) ? values.slice(0, max) : [];
  const merged = [nextValue, ...current.filter((v) => v !== nextValue)];
  return merged.slice(0, max);
}

function normalizeTextLength(text, limit = 500) {
  const body = String(text || "").trim();
  if (body.length <= limit) return body;
  return `${body.slice(0, Math.max(1, limit - 3)).trim()}...`;
}

function buildAutonomousBody(identity) {
  const adaptation = identity.adaptation || {};
  const topic = pickRandom(TOPICS, "AI活用");
  const emoji = pickRandom(identity?.style?.emoji || ["✨"], "✨");
  const opener = pickRandom(identity?.style?.opener || [], `${IDENTITY_DISPLAY_NAME}です。`);
  const closer = pickRandom(identity?.style?.closer || [], "一緒に実験していきましょう。");

  const quickActions = [
    "まず30分で試せる最小タスクを1つ切り出す",
    "実施前に見る指標を1つだけ決める",
    "翌日に改善点を1つだけ反映する"
  ];

  const selectedActions = shouldUseNumber(adaptation)
    ? quickActions.map((action, idx) => `${idx + 1}. ${action}`).join("\n")
    : `- ${pickRandom(quickActions, quickActions[0])}`;

  const insightLine = `今日のテーマは「${topic}」。派手な施策より、再現できる小さな改善が一番強いです。`;
  const questionTail = shouldUseQuestion(adaptation)
    ? "あなたのチームで次に試す1手は何ですか？"
    : "現場で使える形まで落とし込んでいきます。";

  const hashtags = (Array.isArray(identity.hashtag_pool) ? identity.hashtag_pool : BASE_HASHTAGS)
    .map(normalizeHashtag)
    .filter(Boolean)
    .slice(0, 3)
    .join(" ");

  const body = [
    `${opener}${emoji}`,
    insightLine,
    selectedActions,
    `${closer} ${questionTail}`,
    hashtags
  ]
    .filter(Boolean)
    .join("\n\n");

  const normalizedBody = normalizeTextLength(body, 500);
  const textHash = crypto.createHash("sha256").update(normalizedBody).digest("hex");

  return {
    topic,
    body: normalizedBody,
    hashtags: hashtags ? hashtags.split(/\s+/).filter(Boolean) : [],
    textHash
  };
}

async function getPendingPublishCount(db) {
  const row = await db.get(
    `SELECT COUNT(*) AS count
     FROM marketing_publish_jobs
     WHERE channel = 'x'
       AND status IN ('queued', 'processing')`
  );
  return Number(row?.count || row?.COUNT || 0);
}

async function getRecentPublishedPosts(db, limit = 200) {
  return db.all(
    `SELECT id, published_at
     FROM marketing_posts
     WHERE channel = 'x'
     ORDER BY published_at DESC
     LIMIT ?`,
    [limit]
  );
}

async function queueAutonomousPost(db, identity, bodyPayload) {
  const now = nowIso();
  const contentId = crypto.randomUUID();
  const jobId = crypto.randomUUID();
  const briefId = `autonomous:${IDENTITY_ID}:${dateKeyInTz(now, TIMEZONE)}`;

  await db.run(
    `INSERT INTO marketing_contents (
      id, brief_id, channel, format, title, body_text, hashtags_json,
      status, media_asset_url, created_at, updated_at
    ) VALUES (?, ?, 'x', 'text', NULL, ?, ?, 'approved', NULL, ?, ?)`,
    [contentId, briefId, bodyPayload.body, safeJsonStringify(bodyPayload.hashtags) || "[]", now, now]
  );

  await db.run(
    `INSERT INTO marketing_publish_jobs (
      id, content_id, channel, scheduled_at, status,
      attempt_count, next_attempt_at, last_error, created_at, updated_at
    ) VALUES (?, ?, 'x', ?, 'queued', 0, NULL, NULL, ?, ?)`,
    [jobId, contentId, now, now, now]
  );

  await db.run(
    `UPDATE marketing_contents
     SET status = 'publish_queued',
         updated_at = ?
     WHERE id = ?`,
    [now, contentId]
  );

  identity.memory = {
    ...identity.memory,
    recent_topic_keys: nextRecentList(identity.memory?.recent_topic_keys, bodyPayload.topic),
    recent_text_hashes: nextRecentList(identity.memory?.recent_text_hashes, bodyPayload.textHash)
  };

  return {
    content_id: contentId,
    job_id: jobId,
    topic: bodyPayload.topic
  };
}

function hasRecentHash(identity, hash) {
  const hashes = Array.isArray(identity?.memory?.recent_text_hashes) ? identity.memory.recent_text_hashes : [];
  return hashes.includes(hash);
}

async function runCycle(db) {
  const now = nowIso();
  const profile = await getIdentityProfile(db);

  const metricsSync = await syncRecentMetrics(db);
  const samples = await getReactionSamples(db);
  const adaptation = buildAdaptation(profile.identity, samples);
  profile.identity = mergeIdentityWithAdaptation(profile.identity, adaptation);
  await saveIdentityProfile(db, profile);

  if (!withinActiveHours(now, TIMEZONE)) {
    return {
      action: "skip_outside_active_hours",
      at: now,
      timezone: TIMEZONE,
      active_hours: [ACTIVE_HOUR_START, ACTIVE_HOUR_END],
      metrics_sync: metricsSync,
      adaptation: adaptation.summary
    };
  }

  const pendingCount = await getPendingPublishCount(db);
  if (pendingCount > 0) {
    return {
      action: "skip_pending_job_exists",
      at: now,
      pending_jobs: pendingCount,
      metrics_sync: metricsSync,
      adaptation: adaptation.summary
    };
  }

  const recentPosts = await getRecentPublishedPosts(db, 400);
  const todayKey = dateKeyInTz(now, TIMEZONE);
  const postedToday = recentPosts.filter((row) => dateKeyInTz(row.published_at, TIMEZONE) === todayKey).length;
  if (postedToday >= DAILY_POST_LIMIT) {
    return {
      action: "skip_daily_limit_reached",
      at: now,
      posted_today: postedToday,
      daily_limit: DAILY_POST_LIMIT,
      metrics_sync: metricsSync,
      adaptation: adaptation.summary
    };
  }

  const latestPublishedAt = recentPosts[0]?.published_at || null;
  if (latestPublishedAt) {
    const elapsedMs = Date.now() - new Date(latestPublishedAt).getTime();
    if (elapsedMs < MIN_INTERVAL_MINUTES * 60 * 1000) {
      return {
        action: "skip_min_interval",
        at: now,
        posted_today: postedToday,
        minutes_since_last_post: Math.floor(elapsedMs / 60000),
        min_interval_minutes: MIN_INTERVAL_MINUTES,
        metrics_sync: metricsSync,
        adaptation: adaptation.summary
      };
    }
  }

  let bodyPayload = buildAutonomousBody(profile.identity);
  for (let i = 0; i < 3 && hasRecentHash(profile.identity, bodyPayload.textHash); i += 1) {
    bodyPayload = buildAutonomousBody(profile.identity);
  }

  const queued = await queueAutonomousPost(db, profile.identity, bodyPayload);
  await saveIdentityProfile(db, profile);

  return {
    action: "queued",
    at: now,
    posted_today: postedToday,
    daily_limit: DAILY_POST_LIMIT,
    content_id: queued.content_id,
    job_id: queued.job_id,
    topic: queued.topic,
    metrics_sync: metricsSync,
    adaptation: adaptation.summary
  };
}

async function main() {
  if (!WORKER_ENABLED) {
    console.log("marketing autonomous worker is disabled (MARKETING_AUTONOMOUS_WORKER_ENABLED!=true)");
    return;
  }
  if (!EXECUTE_PLACEHOLDER) {
    console.log(
      "marketing autonomous worker is in safe mode (set MARKETING_AUTONOMOUS_PLACEHOLDER_EXECUTE=true to run autonomous enqueue)"
    );
    return;
  }
  if (REQUIRE_X_AUTH && !isXMetricsConfigured()) {
    console.log("marketing autonomous worker skipped: x auth env is missing (set MARKETING_AUTONOMOUS_REQUIRE_X_AUTH=false to bypass)");
    return;
  }

  const db = buildDb();
  try {
    await ensureTables(db);

    if (!CONTINUOUS) {
      const result = await runCycle(db);
      console.log(JSON.stringify(result));
      return;
    }

    while (true) {
      const result = await runCycle(db);
      console.log(JSON.stringify(result));
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error("marketing autonomous worker failed", error);
  process.exit(1);
});
