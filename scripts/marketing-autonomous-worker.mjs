import crypto from "node:crypto";
import { spawn } from "node:child_process";
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

const AI_GENERATION_ENABLED = process.env.MARKETING_AUTONOMOUS_LLM_ENABLED !== "false";
const AI_GENERATOR_RAW = (process.env.MARKETING_AUTONOMOUS_GENERATOR || "openclaw").trim().toLowerCase();
const AI_GENERATOR = AI_GENERATOR_RAW === "api" ? "api" : "openclaw";

const OPENCLAW_BIN = (process.env.MARKETING_AUTONOMOUS_OPENCLAW_BIN || "openclaw").trim();
const OPENCLAW_AGENT_ID = (process.env.MARKETING_AUTONOMOUS_OPENCLAW_AGENT_ID || "main").trim();
const OPENCLAW_SESSION_ID = (
  process.env.MARKETING_AUTONOMOUS_OPENCLAW_SESSION_ID || `autonomous-${IDENTITY_ID}-x`
).trim();
const OPENCLAW_THINKING = (process.env.MARKETING_AUTONOMOUS_OPENCLAW_THINKING || "low").trim();
const OPENCLAW_TIMEOUT_SECONDS = clamp(
  Number(process.env.MARKETING_AUTONOMOUS_OPENCLAW_TIMEOUT_SECONDS || 180),
  30,
  900
);

const LLM_PROVIDER = (process.env.MARKETING_AUTONOMOUS_LLM_PROVIDER || "xai").trim().toLowerCase();
const LLM_MODEL = (
  process.env.MARKETING_AUTONOMOUS_LLM_MODEL ||
  (LLM_PROVIDER === "openai" ? "gpt-4.1-mini" : "grok-3-mini")
).trim();
const LLM_BASE_URL = (
  process.env.MARKETING_AUTONOMOUS_LLM_BASE_URL ||
  (LLM_PROVIDER === "openai" ? "https://api.openai.com/v1" : "https://api.x.ai/v1")
)
  .trim()
  .replace(/\/$/, "");
const LLM_API_KEY = (
  process.env.MARKETING_AUTONOMOUS_LLM_API_KEY ||
  process.env.XAI_API_KEY ||
  process.env.OPENAI_API_KEY ||
  ""
).trim();
const LLM_TIMEOUT_MS = Number(process.env.MARKETING_AUTONOMOUS_LLM_TIMEOUT_MS || 30000);
const AI_MAX_ATTEMPTS = clamp(Number(process.env.MARKETING_AUTONOMOUS_LLM_MAX_ATTEMPTS || 3), 1, 6);
const AI_FALLBACK_TEMPLATE = process.env.MARKETING_AUTONOMOUS_LLM_FALLBACK_TEMPLATE !== "false";
const POST_CHECK_MIN_SCORE = clamp(Number(process.env.MARKETING_AUTONOMOUS_POST_CHECK_MIN_SCORE || 70), 40, 100);
const POST_MIN_CHARS = clamp(Number(process.env.MARKETING_AUTONOMOUS_POST_MIN_CHARS || 90), 40, 500);
const POST_MAX_CHARS = clamp(Number(process.env.MARKETING_AUTONOMOUS_POST_MAX_CHARS || 220), 80, 900);
const POST_MAX_HASHTAGS = clamp(Number(process.env.MARKETING_AUTONOMOUS_POST_MAX_HASHTAGS || 2), 1, 6);
const POST_MAX_EMOJIS = clamp(Number(process.env.MARKETING_AUTONOMOUS_POST_MAX_EMOJIS || 2), 0, 6);
const POST_TONE_POLICY_RAW = (process.env.MARKETING_AUTONOMOUS_POST_TONE_POLICY || "strict").trim().toLowerCase();
const POST_TONE_POLICY = ["strict", "balanced", "free"].includes(POST_TONE_POLICY_RAW)
  ? POST_TONE_POLICY_RAW
  : "strict";

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

function parseJsonObjectFromText(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;

  const tryParse = (value) => {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  };

  const direct = tryParse(text);
  if (direct && typeof direct === "object") return direct;

  const unfenced = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const parsedUnfenced = tryParse(unfenced);
  if (parsedUnfenced && typeof parsedUnfenced === "object") return parsedUnfenced;

  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const sliced = unfenced.slice(start, end + 1);
    const parsedSliced = tryParse(sliced);
    if (parsedSliced && typeof parsedSliced === "object") return parsedSliced;
  }
  return null;
}

function extractJsonObjects(raw) {
  const text = String(raw || "");
  const parsed = [];

  for (let start = 0; start < text.length; start += 1) {
    if (text[start] !== "{") continue;
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < text.length; i += 1) {
      const ch = text[i];
      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === "\\") {
          escaped = true;
          continue;
        }
        if (ch === '"') {
          inString = false;
        }
        continue;
      }

      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === "{") depth += 1;
      if (ch === "}") {
        depth -= 1;
        if (depth === 0) {
          const candidate = text.slice(start, i + 1);
          const parsedCandidate = safeJsonParse(candidate, null);
          if (parsedCandidate && typeof parsedCandidate === "object") {
            parsed.push(parsedCandidate);
          }
          break;
        }
        if (depth < 0) break;
      }
    }
  }

  return parsed;
}

function collectStringCandidates(node, pathKeys = [], out = []) {
  if (typeof node === "string") {
    const value = node.trim();
    if (value) out.push({ value, path: pathKeys.join(".") });
    return out;
  }
  if (Array.isArray(node)) {
    node.forEach((item, idx) => collectStringCandidates(item, [...pathKeys, String(idx)], out));
    return out;
  }
  if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      collectStringCandidates(value, [...pathKeys, key], out);
    }
  }
  return out;
}

function pickBestTextCandidate(candidates) {
  if (!Array.isArray(candidates) || !candidates.length) return "";

  let best = "";
  let bestScore = -Infinity;
  for (const item of candidates) {
    const value = String(item?.value || "").trim();
    if (!value) continue;
    const path = String(item?.path || "").toLowerCase();
    let score = value.length;
    if (path.includes("content")) score += 80;
    if (path.includes("message")) score += 60;
    if (path.includes("text")) score += 50;
    if (path.includes("reply")) score += 45;
    if (path.includes("output")) score += 40;
    if (path.includes("error")) score -= 120;
    if (path.includes("stderr")) score -= 120;
    if (score > bestScore) {
      best = value;
      bestScore = score;
    }
  }
  return best;
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

function pickTopic(preferredTopics, recentTopics) {
  const topics = Array.isArray(preferredTopics) && preferredTopics.length ? preferredTopics : DEFAULT_TOPICS;
  const recent = Array.isArray(recentTopics) ? new Set(recentTopics) : new Set();
  const candidates = topics.filter((topic) => !recent.has(topic));
  return pickRandom(candidates.length ? candidates : topics, topics[0] || "AI活用");
}

function countEmoji(text) {
  const matches = String(text || "").match(/\p{Extended_Pictographic}/gu);
  return matches ? matches.length : 0;
}

function normalizeBodyText(text) {
  const normalized = String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return normalized;
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
      dialect: "postgres",
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
    dialect: "sqlite",
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

async function ensureSqliteColumn(db, tableName, columnName, columnDef) {
  const rows = await db.all(`PRAGMA table_info(${tableName})`);
  const exists = rows.some((row) => String(row?.name || "").toLowerCase() === columnName.toLowerCase());
  if (exists) return;
  await db.run(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDef}`);
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
      asset_manifest_json TEXT,
      hashtags_json TEXT,
      metadata_json TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL,
      generation_provider TEXT,
      generation_model TEXT,
      generation_prompt TEXT,
      generation_seed INTEGER,
      generation_status TEXT,
      generation_error_code TEXT,
      generation_error_message TEXT,
      generation_latency_ms INTEGER,
      generation_cost_jpy INTEGER,
      generation_raw_response_json TEXT,
      media_asset_url TEXT,
      media_thumb_url TEXT,
      media_duration_sec DOUBLE PRECISION,
      media_width INTEGER,
      media_height INTEGER,
      media_mime_type TEXT,
      product_url TEXT,
      source_context_json TEXT,
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

  if (db.dialect === "sqlite") {
    const marketingContentColumns = [
      ["asset_manifest_json", "TEXT"],
      ["metadata_json", "TEXT"],
      ["version", "INTEGER"],
      ["generation_provider", "TEXT"],
      ["generation_model", "TEXT"],
      ["generation_prompt", "TEXT"],
      ["generation_seed", "INTEGER"],
      ["generation_status", "TEXT"],
      ["generation_error_code", "TEXT"],
      ["generation_error_message", "TEXT"],
      ["generation_latency_ms", "INTEGER"],
      ["generation_cost_jpy", "INTEGER"],
      ["generation_raw_response_json", "TEXT"],
      ["media_thumb_url", "TEXT"],
      ["media_duration_sec", "REAL"],
      ["media_width", "INTEGER"],
      ["media_height", "INTEGER"],
      ["media_mime_type", "TEXT"],
      ["product_url", "TEXT"],
      ["source_context_json", "TEXT"],
      ["updated_at", "TEXT"]
    ];
    for (const [columnName, columnDef] of marketingContentColumns) {
      await ensureSqliteColumn(db, "marketing_contents", columnName, columnDef);
    }
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

function isApiLlmConfigured() {
  return Boolean(LLM_API_KEY) && Boolean(LLM_BASE_URL) && Boolean(LLM_MODEL);
}

function isOpenClawConfigured() {
  return Boolean(OPENCLAW_BIN) && Boolean(OPENCLAW_AGENT_ID) && Boolean(OPENCLAW_SESSION_ID);
}

async function runCommand(bin, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;

    const child = spawn(bin, args, {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 1500).unref();
      reject(new AutonomousError("openclaw_timeout", "openclaw command timeout", { retryable: true }));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error?.code === "ENOENT") {
        reject(new AutonomousError("openclaw_not_found", "openclaw command not found", { retryable: false }));
        return;
      }
      reject(new AutonomousError("openclaw_exec_failed", String(error?.message || "openclaw exec failed"), { retryable: true }));
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        const rawBody = [stdout, stderr].filter(Boolean).join("\n");
        const retryable = /timeout|gateway|temporar|rate|429|5\d\d/i.test(rawBody);
        reject(
          new AutonomousError("openclaw_nonzero_exit", `openclaw exited with code ${code}`, {
            retryable,
            rawBody
          })
        );
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function extractOpenClawReplyText(stdout) {
  const raw = String(stdout || "").trim();
  if (!raw) return "";

  const topLevel = parseJsonObjectFromText(raw);
  const allObjects = topLevel ? [topLevel, ...extractJsonObjects(raw)] : extractJsonObjects(raw);
  for (const obj of allObjects) {
    if (!obj || typeof obj !== "object") continue;
    if (!Array.isArray(obj.payloads)) continue;
    for (const payload of obj.payloads) {
      const text = String(payload?.text || "").trim();
      if (text) return text;
    }
  }

  const candidates = [];
  for (const obj of allObjects) {
    collectStringCandidates(obj, [], candidates);
  }
  if (candidates.length) {
    return pickBestTextCandidate(candidates);
  }
  return raw;
}

async function openclawAgentCompletion(prompt) {
  if (!isOpenClawConfigured()) {
    throw new AutonomousError("openclaw_not_configured", "openclaw generator is not configured", { retryable: false });
  }

  const args = [
    "agent",
    "--agent",
    OPENCLAW_AGENT_ID,
    "--session-id",
    OPENCLAW_SESSION_ID,
    "--message",
    prompt,
    "--json",
    "--thinking",
    OPENCLAW_THINKING,
    "--timeout",
    String(OPENCLAW_TIMEOUT_SECONDS)
  ];

  const { stdout } = await runCommand(OPENCLAW_BIN, args, OPENCLAW_TIMEOUT_SECONDS * 1000);
  const replyText = extractOpenClawReplyText(stdout);
  if (!replyText.trim()) {
    throw new AutonomousError("openclaw_empty_reply", "openclaw returned empty reply", {
      retryable: true,
      rawBody: stdout
    });
  }
  return replyText;
}

async function apiLlmChatCompletion(messages, temperature = 0.8) {
  if (!isApiLlmConfigured()) {
    throw new AutonomousError("llm_not_configured", "autonomous llm is not configured", { retryable: false });
  }

  const url = `${LLM_BASE_URL}/chat/completions`;
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LLM_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: LLM_MODEL,
        temperature,
        messages,
        response_format: { type: "json_object" }
      }),
      signal: AbortSignal.timeout(LLM_TIMEOUT_MS)
    });
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      throw new AutonomousError("llm_timeout", "llm request timeout", { retryable: true });
    }
    throw new AutonomousError("llm_unavailable", "llm request failed", { retryable: true });
  }

  const raw = await response.text();
  if (!response.ok) {
    throw new AutonomousError("llm_http_error", `llm http ${response.status}`, {
      retryable: response.status >= 500 || response.status === 429,
      httpStatus: response.status,
      rawBody: raw
    });
  }

  const body = safeJsonParse(raw, {});
  const content = body?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new AutonomousError("llm_invalid_response", "llm response has no content", {
      retryable: false,
      rawBody: raw
    });
  }
  return content;
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
      tone: "sharp-friendly-social-commentary"
    },
    pillars: ["AI活用", "最新AI潮流", "業務改善", "日本企業あるある", "OpenClaw活用"],
    post_archetypes: [
      "最新AI潮流が社会/仕事に与える影響",
      "日本の大企業あるある×AI",
      "OpenClawを使った現場の学び",
      "明日すぐ使えるAI小技"
    ],
    audience: ["40-60代の実務担当者", "経営者・マネージャー", "現場リーダー"],
    style: {
      opener: [
        "これ、現場でよく見ます。",
        "正直、ここが分かれ目です。",
        "小雪です。今日の気づきです。"
      ],
      closer: [
        "まず1週間だけ試してみてください。",
        "小さく回して、数字で判断しましょう。",
        "あなたの現場なら、どこから始めますか？"
      ],
      emoji: ["🌸", "📊", "✨"]
    },
    hashtag_pool: BASE_HASHTAGS.length
      ? BASE_HASHTAGS
      : ["#AI活用", "#マーケティング", "#業務改善", "#仕事術", "#Sinkai"],
    adaptation: {
      sample_size: 0,
      winning_hashtags: [],
      winning_patterns: [],
      avoid_patterns: [],
      summary: "baseline"
    },
    constraints: {
      emoji_max: POST_MAX_EMOJIS,
      hashtags_max: POST_MAX_HASHTAGS,
      length_min: POST_MIN_CHARS,
      length_max: POST_MAX_CHARS,
      must_include_actionable_tip: true
    },
    banned_phrases: ["絶対に伸びる", "誰でも簡単に稼げる", "これ一択"],
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

function normalizeGeneratedHashtags(value, identity) {
  const fromValue = Array.isArray(value) ? value : [];
  const normalized = fromValue.map(normalizeHashtag).filter(Boolean);
  if (normalized.length) return Array.from(new Set(normalized)).slice(0, POST_MAX_HASHTAGS);
  const fallback = Array.isArray(identity?.hashtag_pool) ? identity.hashtag_pool : BASE_HASHTAGS;
  return fallback.map(normalizeHashtag).filter(Boolean).slice(0, POST_MAX_HASHTAGS);
}

function normalizeSourceType(value) {
  const v = String(value || "").trim().toLowerCase();
  if (!v) return null;
  if (["x_post", "article", "rss", "blog", "official"].includes(v)) return v;
  return null;
}

function normalizeSourceContext(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const sourceType = normalizeSourceType(value.source_type || value.type);
  const sourcePostId = String(value.source_post_id || value.post_id || value.tweet_id || "").trim().slice(0, 120);
  const sourceUrl = String(value.source_url || value.url || "").trim().slice(0, 2000);
  const sourceTitle = String(value.source_title || value.title || "").trim().slice(0, 300);
  const sourcePublisher = String(value.source_publisher || value.publisher || "").trim().slice(0, 120);

  const out = {};
  if (sourceType) out.source_type = sourceType;
  if (sourcePostId) out.source_post_id = sourcePostId;
  if (sourceUrl) out.source_url = sourceUrl;
  if (sourceTitle) out.source_title = sourceTitle;
  if (sourcePublisher) out.source_publisher = sourcePublisher;

  const keys = Object.keys(out);
  if (!keys.length) return null;
  if (out.source_type === "x_post" && !out.source_post_id) return null;
  if (out.source_type !== "x_post" && !out.source_url) return null;
  return out;
}

function evaluatePostQuality(identity, post) {
  const body = normalizeBodyText(post?.body || "");
  const hashtags = normalizeGeneratedHashtags(post?.hashtags || [], identity);
  const bannedPhrases = Array.isArray(identity?.banned_phrases) ? identity.banned_phrases : [];

  const reasons = [];
  let score = 100;

  const minChars = clamp(Number(identity?.constraints?.length_min || POST_MIN_CHARS), 40, 1000);
  const maxChars = clamp(Number(identity?.constraints?.length_max || POST_MAX_CHARS), minChars, 1200);
  if (body.length < minChars) {
    reasons.push(`body too short (${body.length} < ${minChars})`);
    score -= 30;
  }
  if (body.length > maxChars) {
    reasons.push(`body too long (${body.length} > ${maxChars})`);
    score -= 30;
  }

  const emojiCount = countEmoji(body);
  const emojiMax = clamp(Number(identity?.constraints?.emoji_max || POST_MAX_EMOJIS), 0, 12);
  if (emojiCount > emojiMax) {
    reasons.push(`too many emojis (${emojiCount} > ${emojiMax})`);
    score -= 20;
  }

  const hashtagsMax = clamp(Number(identity?.constraints?.hashtags_max || POST_MAX_HASHTAGS), 1, 10);
  if (hashtags.length > hashtagsMax) {
    reasons.push(`too many hashtags (${hashtags.length} > ${hashtagsMax})`);
    score -= 20;
  }

  for (const phrase of bannedPhrases) {
    if (phrase && body.includes(phrase)) {
      reasons.push(`contains banned phrase: ${phrase}`);
      score -= 35;
    }
  }

  if (!/数字|検証|改善|実務|再現|工数|運用|潮流|影響|現場|会社|導入|意思決定|大企業/.test(body)) {
    reasons.push("missing practical/data angle");
    score -= 10;
  }
  if (!/試|やってみ|まずは|まず|次の一手|一歩|見直す|決める|変える|始める/.test(body)) {
    reasons.push("missing actionable next step");
    score -= 10;
  }
  const politeTone = /です|ます|でした|ません|でしょう|ください/.test(body);
  const colloquialTone = /だよ|だな|かな|かも|って|じゃない|わけ|ところ|ですよね|なんだ/.test(body);
  if (POST_TONE_POLICY === "strict" && !politeTone) {
    reasons.push("tone not polite enough");
    score -= 10;
  } else if (POST_TONE_POLICY === "balanced" && !politeTone && !colloquialTone) {
    reasons.push("tone too rigid");
    score -= 6;
  }
  if (/煽|炎上|殴|バカ|情弱|搾取/.test(body)) {
    reasons.push("unsafe aggressive tone");
    score -= 40;
  }
  if (/投稿テスト|動作確認|実装アップデート|検証中|テストです/.test(body)) {
    reasons.push("meta operational wording is not allowed");
    score -= 35;
  }

  const normalizedBody = normalizeTextLength(body, 500);
  const textHash = crypto.createHash("sha256").update(normalizedBody).digest("hex");
  const passes = score >= POST_CHECK_MIN_SCORE && reasons.length < 3;

  return {
    passes,
    score: clamp(score, 0, 100),
    reasons,
    body: normalizedBody,
    hashtags,
    textHash
  };
}

function buildFallbackBody(identity) {
  const adaptation = identity.adaptation || {};
  const topic = pickTopic(TOPICS, identity?.memory?.recent_topic_keys);
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

  const insightLine = `今日のテーマは「${topic}」。派手さより、再現できる小さな改善がいちばん強いです。`;
  const questionTail = shouldUseQuestion(adaptation)
    ? "あなたの現場で次に試す1手は何ですか？"
    : "現場で使える形まで落とし込みます。";

  const hashtags = (Array.isArray(identity.hashtag_pool) ? identity.hashtag_pool : BASE_HASHTAGS)
    .map(normalizeHashtag)
    .filter(Boolean)
    .slice(0, POST_MAX_HASHTAGS)
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

function buildLlmSystemPrompt(identity) {
  const banned = Array.isArray(identity?.banned_phrases) ? identity.banned_phrases : [];
  const styleOpeners = Array.isArray(identity?.style?.opener) ? identity.style.opener : [];
  const styleClosers = Array.isArray(identity?.style?.closer) ? identity.style.closer : [];
  const pillars = Array.isArray(identity?.pillars) ? identity.pillars : [];
  const archetypes = Array.isArray(identity?.post_archetypes) ? identity.post_archetypes : [];
  const toneInstruction =
    POST_TONE_POLICY === "strict"
      ? "40-60代の実務層にも信頼される丁寧語を保つこと。"
      : POST_TONE_POLICY === "balanced"
        ? "丁寧語をベースにしつつ、自然な口語を交えて読みやすくすること。"
        : "自然な口語を優先し、押しつけないトーンで書くこと。";

  return [
    `あなたは${IDENTITY_DISPLAY_NAME}。Sinkaiのマーケター。`,
    toneInstruction,
    "狙いは『共感される気づき + 実務で使える一手』。固すぎる説明文は禁止。",
    "冒頭1文はフックを作る（あるある/対比/意外性のどれか）。",
    "改行を使ってテンポよく見せる。1-2文ごとに改行。",
    "過度な煽り・断定・不安商法は禁止。",
    `主な投稿軸: ${pillars.join(" / ")}`,
    `優先する切り口: ${archetypes.join(" / ") || "AI潮流の社会影響 / 現場あるある / 明日から使える工夫"}`,
    `使ってよい導入例: ${styleOpeners.join(" / ")}`,
    `使ってよい締め例: ${styleClosers.join(" / ")}`,
    `禁止表現: ${banned.join(" / ") || "過度な煽り・断定"}`,
    `制約: 本文は${POST_MIN_CHARS}-${POST_MAX_CHARS}文字、絵文字は最大${POST_MAX_EMOJIS}個、ハッシュタグ最大${POST_MAX_HASHTAGS}個。`,
    "事実不明の断定は禁止。攻撃的・不安煽りは禁止。"
  ].join("\n");
}

function buildLlmUserPrompt(identity, topic, adaptation, retryReasons = []) {
  const winningTags = Array.isArray(adaptation?.winning_hashtags) ? adaptation.winning_hashtags : [];
  const winningPatterns = Array.isArray(adaptation?.winning_patterns) ? adaptation.winning_patterns : [];
  const avoidPatterns = Array.isArray(adaptation?.avoid_patterns) ? adaptation.avoid_patterns : [];
  const recentTopics = Array.isArray(identity?.memory?.recent_topic_keys) ? identity.memory.recent_topic_keys : [];

  const feedback = retryReasons.length
    ? `前回案の修正点: ${retryReasons.join(" / ")}`
    : "初回生成";

  return [
    `${feedback}`,
    `今回の主題トピック: ${topic}`,
    "目的: バズを狙いつつ、読む人が『自分ごと』化できる投稿にする。",
    `最近使ったトピック（重複回避）: ${recentTopics.join(", ") || "なし"}`,
    `反応が良かった傾向: tags=${winningTags.join(", ") || "なし"} / patterns=${winningPatterns.join(", ") || "なし"}`,
    `避けたい傾向: ${avoidPatterns.join(", ") || "なし"}`,
    "出力はJSONのみ。スキーマ:",
    '{"topic":"string","body_text":"string","hashtags":["#tag1","#tag2"],"source_context":{"source_type":"x_post|article|rss|blog|official","source_post_id":"string?","source_url":"string?","source_title":"string?","source_publisher":"string?"}}',
    "source_contextは任意。自然に参照すべき情報源がある時だけ入れる。なければnullでよい。",
    "x投稿を参照する場合は source_type=x_post と source_post_id を必ず入れる。",
    "運用メタ発言（投稿テスト/動作確認/実装アップデート）は禁止。",
    "本文は次の構成にする: フック1文 → 背景/解像度1-2文 → すぐ試せる1アクション → 一言締め。",
    "次のNGは避ける: 教科書口調、抽象論だけ、フォロワー運用の話だけ。"
  ].join("\n");
}

function normalizeGeneratedPayload(parsed, topic, identity) {
  const normalizeFromObject = (value) => {
    if (!value || typeof value !== "object") return null;
    const bodyCandidate = value.body_text || value.body || value.text;
    if (typeof bodyCandidate !== "string" || !bodyCandidate.trim()) return null;
    const sourceContext = normalizeSourceContext(
      value.source_context ||
        value.source || {
          source_type: value.source_type,
          source_post_id: value.source_post_id,
          source_url: value.source_url,
          source_title: value.source_title,
          source_publisher: value.source_publisher
        }
    );
    const productUrl = String(value.product_url || "").trim().slice(0, 2000) || null;
    return {
      topic: String(value.topic || topic).trim() || topic,
      body: normalizeBodyText(bodyCandidate),
      hashtags: normalizeGeneratedHashtags(value.hashtags, identity),
      source_context: sourceContext,
      product_url: productUrl
    };
  };

  const direct = normalizeFromObject(parsed);
  if (direct) return direct;

  const queue = [parsed];
  for (let i = 0; i < queue.length; i += 1) {
    const node = queue[i];
    if (!node || typeof node !== "object") continue;

    if (Array.isArray(node)) {
      queue.push(...node);
      continue;
    }

    for (const value of Object.values(node)) {
      if (!value) continue;
      if (typeof value === "string") {
        const parsedText = parseJsonObjectFromText(value);
        const normalizedFromText = normalizeFromObject(parsedText);
        if (normalizedFromText) return normalizedFromText;
        continue;
      }
      if (typeof value === "object") {
        const normalizedNested = normalizeFromObject(value);
        if (normalizedNested) return normalizedNested;
        queue.push(value);
      }
    }
  }

  return null;
}

async function generateAutonomousBodyWithAi(identity) {
  const topic = pickTopic(TOPICS, identity?.memory?.recent_topic_keys);
  let retryReasons = [];

  for (let i = 0; i < AI_MAX_ATTEMPTS; i += 1) {
    const messages = [
      { role: "system", content: buildLlmSystemPrompt(identity) },
      { role: "user", content: buildLlmUserPrompt(identity, topic, identity?.adaptation || {}, retryReasons) }
    ];

    let rawOutput = "";
    if (AI_GENERATOR === "openclaw") {
      const fullPrompt = `${messages[0].content}\n\n${messages[1].content}\n\nJSONのみを返してください。コードブロックは禁止。`;
      rawOutput = await openclawAgentCompletion(fullPrompt);
    } else {
      rawOutput = await apiLlmChatCompletion(messages, 0.9);
    }

    const parsed = parseJsonObjectFromText(rawOutput);
    const candidate = normalizeGeneratedPayload(parsed, topic, identity);
    if (!candidate) {
      retryReasons = ["json parse failed"];
      continue;
    }

    const evaluated = evaluatePostQuality(identity, candidate);
    if (evaluated.passes) {
      return {
        topic: candidate.topic,
        body: evaluated.body,
        hashtags: evaluated.hashtags,
        textHash: evaluated.textHash,
        quality_score: evaluated.score,
        source: AI_GENERATOR === "openclaw" ? "openclaw" : "llm_api",
        source_context: candidate.source_context || null,
        product_url: candidate.product_url || null
      };
    }
    retryReasons = evaluated.reasons.slice(0, 4);
  }

  throw new AutonomousError("ai_post_check_failed", "ai output failed post checks", {
    retryable: false
  });
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
      status, media_asset_url, product_url, source_context_json, created_at, updated_at
    ) VALUES (?, ?, 'x', 'text', NULL, ?, ?, 'approved', NULL, ?, ?, ?, ?)`,
    [
      contentId,
      briefId,
      bodyPayload.body,
      safeJsonStringify(bodyPayload.hashtags) || "[]",
      bodyPayload.product_url || null,
      safeJsonStringify(bodyPayload.source_context) || null,
      now,
      now
    ]
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
    topic: bodyPayload.topic,
    source_type: bodyPayload?.source_context?.source_type || null
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

  let bodyPayload = null;
  let generationSource = "template";
  let generationNote = "";

  try {
    if (!AI_GENERATION_ENABLED) {
      throw new AutonomousError("ai_generation_disabled", "ai generation is disabled", { retryable: false });
    }
    bodyPayload = await generateAutonomousBodyWithAi(profile.identity);
    generationSource = `ai:${AI_GENERATOR}`;
  } catch (error) {
    if (!AI_FALLBACK_TEMPLATE) {
      return {
        action: "skip_ai_generation_failed",
        at: now,
        reason: error?.code || "ai_generation_failed",
        message: String(error?.message || "unknown"),
        metrics_sync: metricsSync,
        adaptation: adaptation.summary
      };
    }
    const fallback = buildFallbackBody(profile.identity);
    const checkedFallback = evaluatePostQuality(profile.identity, fallback);
    if (!checkedFallback.passes) {
      return {
        action: "skip_generation_fallback_failed",
        at: now,
        reason: "fallback_post_check_failed",
        details: checkedFallback.reasons.slice(0, 4),
        metrics_sync: metricsSync,
        adaptation: adaptation.summary
      };
    }
    bodyPayload = {
      topic: fallback.topic,
      body: checkedFallback.body,
      hashtags: checkedFallback.hashtags,
      textHash: checkedFallback.textHash,
      source_context: null,
      product_url: null
    };
    generationSource = "template_fallback";
    generationNote = String(error?.code || "ai_generation_failed");
  }

  for (let i = 0; i < 3 && hasRecentHash(profile.identity, bodyPayload.textHash); i += 1) {
    if (generationSource.startsWith("ai:")) {
      try {
        bodyPayload = await generateAutonomousBodyWithAi(profile.identity);
      } catch {
        bodyPayload = buildFallbackBody(profile.identity);
        generationSource = "template_fallback";
      }
    } else {
      bodyPayload = buildFallbackBody(profile.identity);
    }
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
    source_type: queued.source_type,
    generation_source: generationSource,
    generation_note: generationNote || null,
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
