import crypto from "crypto";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getDb } from "@/lib/db";
import {
  generateHumanApiKey,
  hashHumanApiKey,
  normalizeRequestedScopes
} from "@/lib/human-api-auth";
import { getCurrentHumanIdByEmail } from "@/lib/human-session";

function resolveExpiry(value: unknown, fallbackIso: string | null): string | null {
  if (value === null || value === undefined || value === "") return fallbackIso;
  const days = Number(value);
  if (!Number.isFinite(days)) return fallbackIso;
  const clamped = Math.min(365, Math.max(1, Math.floor(days)));
  const expiresAt = new Date(Date.now() + clamped * 24 * 60 * 60 * 1000);
  return expiresAt.toISOString();
}

async function resolveSessionHumanId() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return null;
  return getCurrentHumanIdByEmail(email);
}

export async function POST(
  request: Request,
  { params }: any
) {
  const humanId = await resolveSessionHumanId();
  if (!humanId) return NextResponse.json({ status: "unauthorized" }, { status: 401 });

  const keyId = (params.keyId || "").trim();
  if (!keyId) {
    return NextResponse.json({ status: "error", reason: "invalid_request" }, { status: 400 });
  }

  const payload: any = await request.json().catch(() => ({}));
  const db = getDb();
  const existing = await db
    .prepare(
      `SELECT id, name, scopes_json, expires_at, status
       FROM human_api_keys
       WHERE id = ? AND human_id = ?`
    )
    .get<{
      id: string;
      name: string;
      scopes_json: string;
      expires_at: string | null;
      status: string;
    }>(keyId, humanId);
  if (!existing?.id) return NextResponse.json({ status: "not_found" }, { status: 404 });
  if (existing.status !== "active") {
    return NextResponse.json({ status: "error", reason: "key_not_active" }, { status: 409 });
  }

  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE human_api_keys
       SET status = 'revoked', revoked_at = ?
       WHERE id = ? AND human_id = ?`
    )
    .run(now, keyId, humanId);

  const generated = generateHumanApiKey();
  const newId = crypto.randomUUID();
  const scopes = (() => {
    if (payload?.scopes) return normalizeRequestedScopes(payload.scopes);
    try {
      return normalizeRequestedScopes(JSON.parse(existing.scopes_json || "[]"));
    } catch {
      return normalizeRequestedScopes([]);
    }
  })();
  const expiresAt = resolveExpiry(payload?.expires_in_days, existing.expires_at);
  await db
    .prepare(
      `INSERT INTO human_api_keys
       (id, human_id, name, key_prefix, key_hash, scopes_json, status, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`
    )
    .run(
      newId,
      humanId,
      existing.name,
      generated.prefix,
      hashHumanApiKey(generated.key),
      JSON.stringify(scopes),
      expiresAt,
      now
    );

  return NextResponse.json({
    status: "rotated",
    replaced_key_id: keyId,
    key: {
      id: newId,
      name: existing.name,
      prefix: generated.prefix,
      api_key: generated.key,
      scopes,
      expires_at: expiresAt,
      created_at: now
    }
  });
}
