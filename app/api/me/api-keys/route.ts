import crypto from "crypto";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getDb } from "@/lib/db";
import {
  DEFAULT_HUMAN_API_SCOPES,
  generateHumanApiKey,
  hashHumanApiKey,
  normalizeRequestedScopes
} from "@/lib/human-api-auth";
import { getCurrentHumanIdByEmail } from "@/lib/human-session";

const MAX_ACTIVE_KEYS = 5;

function normalizeName(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed.length > 80 ? trimmed.slice(0, 80) : trimmed;
}

function resolveExpiry(value: unknown): string | null {
  const days = Number(value);
  const safeDays = Number.isFinite(days) ? Math.floor(days) : 90;
  const clamped = Math.min(365, Math.max(1, safeDays));
  const expiresAt = new Date(Date.now() + clamped * 24 * 60 * 60 * 1000);
  return expiresAt.toISOString();
}

async function resolveSessionHuman() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return null;
  const humanId = await getCurrentHumanIdByEmail(email);
  if (!humanId) return null;
  return { email, humanId };
}

export async function GET(request: Request) {
  const actor = await resolveSessionHuman();
  if (!actor) return NextResponse.json({ status: "unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const includeRevoked = url.searchParams.get("include_revoked") === "1";
  const db = getDb();

  const rows = await db
    .prepare(
      `SELECT
         id,
         name,
         key_prefix,
         scopes_json,
         status,
         last_used_at,
         expires_at,
         revoked_at,
         created_at
       FROM human_api_keys
       WHERE human_id = ?
         ${includeRevoked ? "" : "AND status = 'active'"}
       ORDER BY created_at DESC`
    )
    .all<{
      id: string;
      name: string;
      key_prefix: string;
      scopes_json: string;
      status: string;
      last_used_at: string | null;
      expires_at: string | null;
      revoked_at: string | null;
      created_at: string;
    }>(actor.humanId);

  return NextResponse.json({
    keys: rows.map((row) => ({
      id: row.id,
      name: row.name,
      prefix: row.key_prefix,
      scopes: (() => {
        try {
          return normalizeRequestedScopes(JSON.parse(row.scopes_json || "[]"));
        } catch {
          return DEFAULT_HUMAN_API_SCOPES;
        }
      })(),
      status: row.status,
      last_used_at: row.last_used_at,
      expires_at: row.expires_at,
      revoked_at: row.revoked_at,
      created_at: row.created_at
    }))
  });
}

export async function POST(request: Request) {
  const actor = await resolveSessionHuman();
  if (!actor) return NextResponse.json({ status: "unauthorized" }, { status: 401 });

  const payload: any = await request.json().catch(() => ({}));
  const name = normalizeName(payload?.name) || "Human API Key";
  const scopes = normalizeRequestedScopes(payload?.scopes ?? DEFAULT_HUMAN_API_SCOPES);
  const expiresAt = resolveExpiry(payload?.expires_in_days);

  const db = getDb();
  const human = await db
    .prepare(`SELECT api_access_status FROM humans WHERE id = ? AND deleted_at IS NULL`)
    .get<{ api_access_status: string | null }>(actor.humanId);
  if (!human) return NextResponse.json({ status: "not_found" }, { status: 404 });
  if ((human.api_access_status || "active") !== "active") {
    return NextResponse.json({ status: "error", reason: "api_access_disabled" }, { status: 403 });
  }

  const activeCountRow = await db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM human_api_keys
       WHERE human_id = ? AND status = 'active'`
    )
    .get<{ count: number }>(actor.humanId);
  const activeCount = Number(activeCountRow?.count ?? 0);
  if (activeCount >= MAX_ACTIVE_KEYS) {
    return NextResponse.json({ status: "error", reason: "too_many_active_keys" }, { status: 409 });
  }

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const generated = generateHumanApiKey();
  const keyHash = hashHumanApiKey(generated.key);

  await db
    .prepare(
      `INSERT INTO human_api_keys
       (id, human_id, name, key_prefix, key_hash, scopes_json, status, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`
    )
    .run(
      id,
      actor.humanId,
      name,
      generated.prefix,
      keyHash,
      JSON.stringify(scopes),
      expiresAt,
      createdAt
    );

  return NextResponse.json({
    status: "created",
    key: {
      id,
      name,
      prefix: generated.prefix,
      api_key: generated.key,
      scopes,
      expires_at: expiresAt,
      created_at: createdAt
    }
  });
}
