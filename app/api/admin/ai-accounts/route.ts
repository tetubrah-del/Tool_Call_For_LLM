import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAdminToken } from "@/lib/admin-auth";

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function GET(request: Request) {
  const authError = requireAdminToken(request);
  if (authError) return authError;

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim().toLowerCase();
  const includeDeleted = url.searchParams.get("include_deleted") === "1";

  const db = getDb();
  const where: string[] = [];
  const params: Array<string | number | null> = [];
  if (!includeDeleted) {
    where.push("deleted_at IS NULL");
  }
  if (q) {
    where.push("(lower(name) LIKE ? OR lower(paypal_email) LIKE ? OR id = ?)");
    params.push(`%${q}%`, `%${q}%`, q);
  }

  const accounts = await db
    .prepare(
      `SELECT id, name, paypal_email, status, created_at, deleted_at
       FROM ai_accounts
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY created_at DESC
       LIMIT 200`
    )
    .all(...params);

  return NextResponse.json({ accounts });
}

export async function DELETE(request: Request) {
  const authError = requireAdminToken(request);
  if (authError) return authError;

  const payload: any = await request.json().catch(() => ({}));
  const id = normalizeText(payload?.id);
  if (!id) {
    return NextResponse.json({ status: "error", reason: "invalid_request" }, { status: 400 });
  }

  const db = getDb();
  const existing = await db
    .prepare(`SELECT id FROM ai_accounts WHERE id = ? AND deleted_at IS NULL`)
    .get<{ id: string }>(id);
  if (!existing?.id) {
    return NextResponse.json({ status: "not_found" }, { status: 404 });
  }

  const now = new Date().toISOString();
  await db
    .prepare(`UPDATE ai_accounts SET deleted_at = ?, status = 'disabled' WHERE id = ?`)
    .run(now, id);

  return NextResponse.json({ status: "deleted", id, deleted_at: now });
}

export async function PATCH(request: Request) {
  const authError = requireAdminToken(request);
  if (authError) return authError;

  const payload: any = await request.json().catch(() => ({}));
  const id = normalizeText(payload?.id);
  if (!id) {
    return NextResponse.json({ status: "error", reason: "invalid_request" }, { status: 400 });
  }

  const db = getDb();
  const existing = await db
    .prepare(`SELECT id FROM ai_accounts WHERE id = ?`)
    .get<{ id: string }>(id);
  if (!existing?.id) {
    return NextResponse.json({ status: "not_found" }, { status: 404 });
  }

  await db.prepare(`UPDATE ai_accounts SET deleted_at = NULL WHERE id = ?`).run(id);
  return NextResponse.json({ status: "restored", id });
}

