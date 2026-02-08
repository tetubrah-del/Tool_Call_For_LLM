import crypto from "crypto";
import type Database from "better-sqlite3";

type IdempotencyRow = {
  route: string;
  idem_key: string;
  ai_account_id: string;
  request_hash: string;
  status_code: number | null;
  response_body: string | null;
};

export type IdempotencyReplay = {
  replay: true;
  blocked: false;
  statusCode: number;
  body: any;
};

export type IdempotencyBlocked = {
  replay: false;
  blocked: true;
  statusCode: number;
  body: any;
};

export type IdempotencyProceed = {
  replay: false;
  blocked: false;
};

export type IdempotencyStartResult =
  | IdempotencyReplay
  | IdempotencyBlocked
  | IdempotencyProceed;

function normalizeBody(payload: unknown) {
  return JSON.stringify(payload ?? {});
}

export function hashPayload(payload: unknown) {
  return crypto.createHash("sha256").update(normalizeBody(payload)).digest("hex");
}

export function startIdempotency(
  db: Database.Database,
  params: {
    route: string;
    idemKey: string | null;
    aiAccountId: string | null;
    payload: unknown;
  }
): IdempotencyStartResult {
  const { route, idemKey, aiAccountId, payload } = params;
  if (!idemKey) {
    return { replay: false, blocked: false };
  }

  const requestHash = hashPayload(payload);
  const scopedAiAccount = aiAccountId || "";
  const now = new Date().toISOString();

  try {
    db.prepare(
      `INSERT INTO idempotency_keys
       (route, idem_key, ai_account_id, request_hash, status_code, response_body, created_at)
       VALUES (?, ?, ?, ?, NULL, NULL, ?)`
    ).run(route, idemKey, scopedAiAccount, requestHash, now);
    return { replay: false, blocked: false };
  } catch {
    const existing = db
      .prepare(
        `SELECT route, idem_key, ai_account_id, request_hash, status_code, response_body
         FROM idempotency_keys
         WHERE route = ? AND idem_key = ? AND ai_account_id = ?`
      )
      .get(route, idemKey, scopedAiAccount) as IdempotencyRow | undefined;

    if (!existing) {
      return {
        replay: false,
        blocked: true,
        statusCode: 500,
        body: { status: "error", reason: "idempotency_error" }
      };
    }

    if (existing.request_hash !== requestHash) {
      return {
        replay: false,
        blocked: true,
        statusCode: 409,
        body: { status: "error", reason: "idempotency_key_conflict" }
      };
    }

    if (existing.status_code == null || !existing.response_body) {
      return {
        replay: false,
        blocked: true,
        statusCode: 409,
        body: { status: "error", reason: "request_in_progress" }
      };
    }

    let parsedBody: any = null;
    try {
      parsedBody = JSON.parse(existing.response_body);
    } catch {
      parsedBody = { status: "error", reason: "idempotency_error" };
    }

    return {
      replay: true,
      blocked: false,
      statusCode: existing.status_code,
      body: parsedBody
    };
  }
}

export function finishIdempotency(
  db: Database.Database,
  params: {
    route: string;
    idemKey: string | null;
    aiAccountId: string | null;
    statusCode: number;
    responseBody: any;
  }
) {
  const { route, idemKey, aiAccountId, statusCode, responseBody } = params;
  if (!idemKey) return;

  db.prepare(
    `UPDATE idempotency_keys
     SET status_code = ?, response_body = ?
     WHERE route = ? AND idem_key = ? AND ai_account_id = ?`
  ).run(statusCode, JSON.stringify(responseBody ?? {}), route, idemKey, aiAccountId || "");
}
