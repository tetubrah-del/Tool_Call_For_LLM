import crypto from "crypto";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import type { DbClient } from "@/lib/db";
import { getDb } from "@/lib/db";
import { getCurrentHumanIdByEmail } from "@/lib/human-session";

const HUMAN_API_KEY_PREFIX = "hu_live_";
const DEFAULT_MONTHLY_LIMIT = 1000;
const WARN_THRESHOLD_PCTS = [5, 1] as const;

export const HUMAN_API_SCOPES = [
  "messages:read",
  "messages:write",
  "submissions:write",
  "payments:read",
  "profile:read"
] as const;

export type HumanApiScope = (typeof HUMAN_API_SCOPES)[number];

export const DEFAULT_HUMAN_API_SCOPES: HumanApiScope[] = [...HUMAN_API_SCOPES];

type ApiKeyRow = {
  key_id: string;
  human_id: string;
  scopes_json: string;
  expires_at: string | null;
  api_access_status: string | null;
  api_monthly_limit: number | null;
};

type UsageReservation = {
  humanId: string;
  apiKeyId: string;
  periodKey: string;
  resetAtIso: string;
  limit: number;
};

type UsageSnapshot = {
  used: number;
  remaining: number;
  limit: number;
  periodKey: string;
  resetAtIso: string;
  warnThresholdPct: number | null;
};

export type HumanAuthSuccess = {
  ok: true;
  humanId: string;
  viaApiKey: boolean;
  apiKeyId: string | null;
  usage: UsageReservation | null;
};

export type HumanAuthResult =
  | HumanAuthSuccess
  | {
      ok: false;
      response: NextResponse;
    };

export function generateHumanApiKey() {
  const prefixId = crypto.randomBytes(4).toString("hex");
  const secret = crypto.randomBytes(24).toString("hex");
  const prefix = `${HUMAN_API_KEY_PREFIX}${prefixId}`;
  return {
    prefix,
    key: `${prefix}_${secret}`
  };
}

export function hashHumanApiKey(rawKey: string) {
  const pepper = process.env.HUMAN_API_KEY_PEPPER || "";
  return crypto
    .createHash("sha256")
    .update(`${pepper}:${rawKey}`)
    .digest("hex");
}

export function normalizeRequestedScopes(input: unknown): HumanApiScope[] {
  if (!Array.isArray(input)) return DEFAULT_HUMAN_API_SCOPES;
  const requested = input
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value): value is HumanApiScope =>
      HUMAN_API_SCOPES.includes(value as HumanApiScope)
    );
  if (requested.length === 0) return DEFAULT_HUMAN_API_SCOPES;
  return [...new Set(requested)];
}

function parseScopesJson(value: string): HumanApiScope[] {
  try {
    const parsed = JSON.parse(value);
    return normalizeRequestedScopes(parsed);
  } catch {
    return [];
  }
}

function parseApiKeyFromRequest(request: Request): string | null {
  const authHeader = request.headers.get("authorization") || "";
  if (authHeader.toLowerCase().startsWith("bearer ")) {
    const token = authHeader.slice(7).trim();
    if (token) return token;
  }
  const fallbackHeader = (request.headers.get("x-human-api-key") || "").trim();
  return fallbackHeader || null;
}

function formatPeriod(now = new Date()) {
  const jstMs = now.getTime() + 9 * 60 * 60 * 1000;
  const jst = new Date(jstMs);
  const year = jst.getUTCFullYear();
  const month = jst.getUTCMonth() + 1;
  const periodKey = `${year}-${String(month).padStart(2, "0")}`;
  const resetAtMs = Date.UTC(year, month, 1, 0, 0, 0) - 9 * 60 * 60 * 1000;
  return { periodKey, resetAtIso: new Date(resetAtMs).toISOString() };
}

function toRateLimitResetUnix(resetAtIso: string): string {
  return String(Math.floor(new Date(resetAtIso).getTime() / 1000));
}

function getWarnThresholdPct(remaining: number, limit: number): number | null {
  for (const threshold of WARN_THRESHOLD_PCTS) {
    if (remaining <= Math.ceil((limit * threshold) / 100)) {
      return threshold;
    }
  }
  return null;
}

async function getUsageCount(db: DbClient, humanId: string, periodKey: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT request_count
       FROM human_api_usage_monthly
       WHERE human_id = ? AND period_key = ?`
    )
    .get<{ request_count: number }>(humanId, periodKey);
  return Number(row?.request_count ?? 0);
}

async function reserveUsage(
  db: DbClient,
  humanId: string,
  limit: number
): Promise<{ ok: true; used: number } | { ok: false; used: number }> {
  const now = new Date().toISOString();
  const { periodKey } = formatPeriod();
  await db
    .prepare(
      `INSERT INTO human_api_usage_monthly (human_id, period_key, request_count, updated_at)
       VALUES (?, ?, 0, ?)
       ON CONFLICT(human_id, period_key) DO NOTHING`
    )
    .run(humanId, periodKey, now);
  const updated = await db
    .prepare(
      `UPDATE human_api_usage_monthly
       SET request_count = request_count + 1, updated_at = ?
       WHERE human_id = ? AND period_key = ? AND request_count < ?`
    )
    .run(now, humanId, periodKey, limit);
  const used = await getUsageCount(db, humanId, periodKey);
  if (updated < 1) return { ok: false, used };
  return { ok: true, used };
}

async function rollbackUsage(db: DbClient, humanId: string, periodKey: string) {
  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE human_api_usage_monthly
       SET request_count = CASE WHEN request_count > 0 THEN request_count - 1 ELSE 0 END,
           updated_at = ?
       WHERE human_id = ? AND period_key = ?`
    )
    .run(now, humanId, periodKey);
}

async function maybeEmitThresholdAlert(
  db: DbClient,
  humanId: string,
  periodKey: string,
  thresholdPct: number
): Promise<boolean> {
  const now = new Date().toISOString();
  const inserted = await db
    .prepare(
      `INSERT INTO human_api_usage_alerts (human_id, period_key, threshold_percent, notified_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(human_id, period_key, threshold_percent) DO NOTHING`
    )
    .run(humanId, periodKey, thresholdPct, now);
  return inserted > 0;
}

async function loadApiKeyRow(
  db: DbClient,
  rawApiKey: string
): Promise<ApiKeyRow | null> {
  const keyHash = hashHumanApiKey(rawApiKey);
  const row = await db
    .prepare(
      `SELECT
         k.id AS key_id,
         k.human_id,
         k.scopes_json,
         k.expires_at,
         h.api_access_status,
         h.api_monthly_limit
       FROM human_api_keys k
       JOIN humans h ON h.id = k.human_id
       WHERE k.key_hash = ?
         AND k.status = 'active'
         AND h.deleted_at IS NULL
       LIMIT 1`
    )
    .get<ApiKeyRow>(keyHash);
  return row ?? null;
}

async function resolveSessionHumanId(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return null;
  return getCurrentHumanIdByEmail(email);
}

function buildAuthError(reason: "unauthorized" | "invalid_credentials" | "forbidden_scope") {
  const status = reason === "forbidden_scope" ? 403 : 401;
  return NextResponse.json({ status: "error", reason }, { status });
}

function buildLimitExceededResponse(snapshot: UsageSnapshot) {
  const res = NextResponse.json(
    {
      status: "error",
      reason: "monthly_limit_exceeded",
      limit: snapshot.limit,
      used: snapshot.used,
      period: snapshot.periodKey,
      reset_at: snapshot.resetAtIso
    },
    { status: 429 }
  );
  res.headers.set("X-RateLimit-Limit", String(snapshot.limit));
  res.headers.set("X-RateLimit-Remaining", String(snapshot.remaining));
  res.headers.set("X-RateLimit-Reset", toRateLimitResetUnix(snapshot.resetAtIso));
  res.headers.set("X-Usage-Warn", "true");
  return res;
}

function appendUsageHeaders(response: NextResponse, snapshot: UsageSnapshot) {
  response.headers.set("X-RateLimit-Limit", String(snapshot.limit));
  response.headers.set("X-RateLimit-Remaining", String(snapshot.remaining));
  response.headers.set("X-RateLimit-Reset", toRateLimitResetUnix(snapshot.resetAtIso));
  response.headers.set("X-Usage-Warn", snapshot.warnThresholdPct ? "true" : "false");
  if (snapshot.warnThresholdPct) {
    response.headers.set("X-Usage-Warn-Threshold", String(snapshot.warnThresholdPct));
  }
  return response;
}

async function getUsageSnapshot(
  db: DbClient,
  humanId: string,
  limit: number,
  periodKey: string,
  resetAtIso: string
): Promise<UsageSnapshot> {
  const used = await getUsageCount(db, humanId, periodKey);
  const remaining = Math.max(0, limit - used);
  return {
    used,
    remaining,
    limit,
    periodKey,
    resetAtIso,
    warnThresholdPct: getWarnThresholdPct(remaining, limit)
  };
}

export async function authenticateHumanRequest(
  request: Request,
  requiredScope: HumanApiScope
): Promise<HumanAuthResult> {
  const db = getDb();
  const rawApiKey = parseApiKeyFromRequest(request);

  if (!rawApiKey) {
    const humanId = await resolveSessionHumanId();
    if (!humanId) return { ok: false, response: buildAuthError("unauthorized") };
    return { ok: true, humanId, viaApiKey: false, apiKeyId: null, usage: null };
  }

  if (!rawApiKey.startsWith(HUMAN_API_KEY_PREFIX)) {
    return { ok: false, response: buildAuthError("invalid_credentials") };
  }

  const row = await loadApiKeyRow(db, rawApiKey);
  if (!row?.human_id) {
    return { ok: false, response: buildAuthError("invalid_credentials") };
  }
  if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) {
    return { ok: false, response: buildAuthError("invalid_credentials") };
  }
  if ((row.api_access_status || "active") !== "active") {
    return { ok: false, response: buildAuthError("unauthorized") };
  }
  const scopes = parseScopesJson(row.scopes_json);
  if (!scopes.includes(requiredScope)) {
    return { ok: false, response: buildAuthError("forbidden_scope") };
  }

  const limit = Number(row.api_monthly_limit ?? DEFAULT_MONTHLY_LIMIT);
  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : DEFAULT_MONTHLY_LIMIT;
  const { periodKey, resetAtIso } = formatPeriod();
  const usage = await reserveUsage(db, row.human_id, safeLimit);
  if (!usage.ok) {
    const snapshot = await getUsageSnapshot(db, row.human_id, safeLimit, periodKey, resetAtIso);
    return { ok: false, response: buildLimitExceededResponse(snapshot) };
  }
  await db
    .prepare(`UPDATE human_api_keys SET last_used_at = ? WHERE id = ?`)
    .run(new Date().toISOString(), row.key_id);

  return {
    ok: true,
    humanId: row.human_id,
    viaApiKey: true,
    apiKeyId: row.key_id,
    usage: {
      humanId: row.human_id,
      apiKeyId: row.key_id,
      periodKey,
      resetAtIso,
      limit: safeLimit
    }
  };
}

export async function finalizeHumanAuthResponse(
  request: Request,
  response: NextResponse,
  auth: HumanAuthSuccess
) {
  if (!auth.viaApiKey || !auth.usage) return response;

  const db = getDb();
  const shouldRollback =
    response.status === 401 ||
    response.status === 403 ||
    response.status === 429 ||
    response.status >= 500;

  if (shouldRollback) {
    await rollbackUsage(db, auth.usage.humanId, auth.usage.periodKey);
  }

  const snapshot = await getUsageSnapshot(
    db,
    auth.usage.humanId,
    auth.usage.limit,
    auth.usage.periodKey,
    auth.usage.resetAtIso
  );

  let alertTriggered = false;
  if (!shouldRollback && snapshot.warnThresholdPct) {
    alertTriggered = await maybeEmitThresholdAlert(
      db,
      auth.usage.humanId,
      auth.usage.periodKey,
      snapshot.warnThresholdPct
    );
  }

  console.info(
    JSON.stringify({
      event: "human_api_request",
      request_id: request.headers.get("x-request-id") || null,
      human_id: auth.usage.humanId,
      api_key_id: auth.usage.apiKeyId,
      path: new URL(request.url).pathname,
      method: request.method,
      status_code: response.status,
      used: snapshot.used,
      remaining: snapshot.remaining,
      limit: snapshot.limit,
      period_key: snapshot.periodKey,
      warn_threshold_pct: snapshot.warnThresholdPct,
      alert_triggered: alertTriggered
    })
  );

  return appendUsageHeaders(response, snapshot);
}

export async function getCurrentPeriodUsage(humanId: string) {
  const db = getDb();
  const { periodKey, resetAtIso } = formatPeriod();
  const human = await db
    .prepare(
      `SELECT api_monthly_limit, api_access_status
       FROM humans
       WHERE id = ? AND deleted_at IS NULL`
    )
    .get<{ api_monthly_limit: number | null; api_access_status: string | null }>(humanId);

  if (!human) return null;
  const limit = Number(human.api_monthly_limit ?? DEFAULT_MONTHLY_LIMIT);
  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : DEFAULT_MONTHLY_LIMIT;
  const snapshot = await getUsageSnapshot(db, humanId, safeLimit, periodKey, resetAtIso);

  return {
    status: (human.api_access_status || "active") as "active" | "disabled",
    period_key: snapshot.periodKey,
    used: snapshot.used,
    limit: snapshot.limit,
    remaining: snapshot.remaining,
    reset_at: snapshot.resetAtIso,
    warning: snapshot.warnThresholdPct
      ? {
          threshold_percent: snapshot.warnThresholdPct
        }
      : null
  };
}
