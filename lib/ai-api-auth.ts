import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

const DEFAULT_AI_MONTHLY_LIMIT = 50000;
const DEFAULT_AI_BURST_PER_MINUTE = 60;
const WARN_PCTS = [80, 95] as const;

type AiAccountRow = {
  id: string;
  api_key: string;
  status: string;
  api_access_status: string | null;
  api_monthly_limit: number | null;
  api_burst_per_minute: number | null;
};

export type AiAuthSuccess = {
  ok: true;
  aiAccountId: string;
  headers: Record<string, string>;
  warnedThresholdPct: number | null;
};

export type AiAuthResult =
  | AiAuthSuccess
  | {
      ok: false;
      response: NextResponse;
    };

function normalizeLimit(value: number | null | undefined, fallback: number) {
  const n = Number(value ?? fallback);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function getBypassIds(): Set<string> {
  const raw = (process.env.AI_API_LIMIT_BYPASS_IDS || "").trim();
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean)
  );
}

function currentMonthKey(now = new Date()) {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  return `${year}-${String(month).padStart(2, "0")}`;
}

function currentMinuteKey(now = new Date()) {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  const hour = String(now.getUTCHours()).padStart(2, "0");
  const min = String(now.getUTCMinutes()).padStart(2, "0");
  return `${year}${month}${day}${hour}${min}`;
}

function monthResetAtIso(now = new Date()) {
  const nextMonthUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0);
  return new Date(nextMonthUtc).toISOString();
}

function minuteResetAtIso(now = new Date()) {
  const nextMinute = new Date(now);
  nextMinute.setUTCSeconds(0, 0);
  nextMinute.setUTCMinutes(nextMinute.getUTCMinutes() + 1);
  return nextMinute.toISOString();
}

function toUnix(iso: string) {
  return String(Math.floor(new Date(iso).getTime() / 1000));
}

function warnedPct(used: number, limit: number): number | null {
  if (limit <= 0) return null;
  const pct = (used / limit) * 100;
  for (const threshold of WARN_PCTS) {
    if (pct >= threshold) return threshold;
  }
  return null;
}

async function maybeRecordWarning(aiAccountId: string, periodKey: string, thresholdPct: number) {
  const db = getDb();
  await db
    .prepare(
      `INSERT INTO ai_api_usage_alerts (ai_account_id, period_key, threshold_percent, notified_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(ai_account_id, period_key, threshold_percent) DO NOTHING`
    )
    .run(aiAccountId, periodKey, thresholdPct, new Date().toISOString());
}

export async function authenticateAiApiRequest(
  aiAccountId: string,
  aiApiKey: string
): Promise<AiAuthResult> {
  if (!aiAccountId || !aiApiKey) {
    return {
      ok: false,
      response: NextResponse.json({ status: "error", reason: "invalid_request" }, { status: 400 })
    };
  }

  const db = getDb();
  const aiAccount = await db
    .prepare(
      `SELECT id, api_key, status, api_access_status, api_monthly_limit, api_burst_per_minute
       FROM ai_accounts
       WHERE id = ? AND deleted_at IS NULL`
    )
    .get<AiAccountRow>(aiAccountId);

  if (!aiAccount || aiAccount.api_key !== aiApiKey || aiAccount.status !== "active") {
    return {
      ok: false,
      response: NextResponse.json({ status: "error", reason: "invalid_credentials" }, { status: 401 })
    };
  }
  if ((aiAccount.api_access_status || "active") !== "active") {
    return {
      ok: false,
      response: NextResponse.json({ status: "error", reason: "api_access_disabled" }, { status: 403 })
    };
  }

  if (getBypassIds().has(aiAccountId)) {
    return {
      ok: true,
      aiAccountId,
      warnedThresholdPct: null,
      headers: {
        "X-AI-RateLimit-Bypass": "true"
      }
    };
  }

  const monthLimit = normalizeLimit(aiAccount.api_monthly_limit, DEFAULT_AI_MONTHLY_LIMIT);
  const minuteLimit = normalizeLimit(aiAccount.api_burst_per_minute, DEFAULT_AI_BURST_PER_MINUTE);
  const now = new Date();
  const periodKey = currentMonthKey(now);
  const minuteKey = currentMinuteKey(now);
  const nowIso = now.toISOString();

  await db
    .prepare(
      `INSERT INTO ai_api_usage_monthly (ai_account_id, period_key, request_count, updated_at)
       VALUES (?, ?, 0, ?)
       ON CONFLICT(ai_account_id, period_key) DO NOTHING`
    )
    .run(aiAccountId, periodKey, nowIso);
  await db
    .prepare(
      `INSERT INTO ai_api_usage_minute (ai_account_id, bucket_key, request_count, updated_at)
       VALUES (?, ?, 0, ?)
       ON CONFLICT(ai_account_id, bucket_key) DO NOTHING`
    )
    .run(aiAccountId, minuteKey, nowIso);

  const minuteChanges = await db
    .prepare(
      `UPDATE ai_api_usage_minute
       SET request_count = request_count + 1, updated_at = ?
       WHERE ai_account_id = ? AND bucket_key = ? AND request_count < ?`
    )
    .run(nowIso, aiAccountId, minuteKey, minuteLimit);
  const minuteRow = await db
    .prepare(
      `SELECT request_count
       FROM ai_api_usage_minute
       WHERE ai_account_id = ? AND bucket_key = ?`
    )
    .get<{ request_count: number }>(aiAccountId, minuteKey);
  const minuteUsed = Number(minuteRow?.request_count ?? 0);
  if (minuteChanges < 1) {
    const resetAt = minuteResetAtIso(now);
    const response = NextResponse.json(
      {
        status: "error",
        reason: "minute_limit_exceeded",
        limit: minuteLimit,
        used: minuteUsed,
        reset_at: resetAt
      },
      { status: 429 }
    );
    response.headers.set("X-AI-RateLimit-Limit-Minute", String(minuteLimit));
    response.headers.set("X-AI-RateLimit-Remaining-Minute", "0");
    response.headers.set("X-AI-RateLimit-Reset-Minute", toUnix(resetAt));
    return { ok: false, response };
  }

  const monthChanges = await db
    .prepare(
      `UPDATE ai_api_usage_monthly
       SET request_count = request_count + 1, updated_at = ?
       WHERE ai_account_id = ? AND period_key = ? AND request_count < ?`
    )
    .run(nowIso, aiAccountId, periodKey, monthLimit);
  const monthRow = await db
    .prepare(
      `SELECT request_count
       FROM ai_api_usage_monthly
       WHERE ai_account_id = ? AND period_key = ?`
    )
    .get<{ request_count: number }>(aiAccountId, periodKey);
  const monthUsed = Number(monthRow?.request_count ?? 0);
  if (monthChanges < 1) {
    // Revert minute increment so monthly rejection does not burn minute quota.
    await db
      .prepare(
        `UPDATE ai_api_usage_minute
         SET request_count = CASE WHEN request_count > 0 THEN request_count - 1 ELSE 0 END,
             updated_at = ?
         WHERE ai_account_id = ? AND bucket_key = ?`
      )
      .run(nowIso, aiAccountId, minuteKey);
    const resetAt = monthResetAtIso(now);
    const response = NextResponse.json(
      {
        status: "error",
        reason: "monthly_limit_exceeded",
        limit: monthLimit,
        used: monthUsed,
        period: periodKey,
        reset_at: resetAt
      },
      { status: 429 }
    );
    response.headers.set("X-AI-RateLimit-Limit-Month", String(monthLimit));
    response.headers.set("X-AI-RateLimit-Remaining-Month", "0");
    response.headers.set("X-AI-RateLimit-Reset-Month", toUnix(resetAt));
    return { ok: false, response };
  }

  const monthRemaining = Math.max(0, monthLimit - monthUsed);
  const minuteRemaining = Math.max(0, minuteLimit - minuteUsed);
  const warning = warnedPct(monthUsed, monthLimit);
  if (warning) {
    await maybeRecordWarning(aiAccountId, periodKey, warning);
  }

  return {
    ok: true,
    aiAccountId,
    warnedThresholdPct: warning,
    headers: {
      "X-AI-RateLimit-Limit-Month": String(monthLimit),
      "X-AI-RateLimit-Remaining-Month": String(monthRemaining),
      "X-AI-RateLimit-Reset-Month": toUnix(monthResetAtIso(now)),
      "X-AI-RateLimit-Limit-Minute": String(minuteLimit),
      "X-AI-RateLimit-Remaining-Minute": String(minuteRemaining),
      "X-AI-RateLimit-Reset-Minute": toUnix(minuteResetAtIso(now)),
      "X-AI-Usage-Warn": warning ? "true" : "false",
      ...(warning ? { "X-AI-Usage-Warn-Threshold": String(warning) } : {})
    }
  };
}

export function applyAiRateLimitHeaders(response: NextResponse, auth: AiAuthSuccess) {
  for (const [key, value] of Object.entries(auth.headers)) {
    response.headers.set(key, value);
  }
  return response;
}
