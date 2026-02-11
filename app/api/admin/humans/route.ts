import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";
import { closeContactChannel } from "@/lib/contact-channel";

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function GET(request: Request) {
  const authError = await requireAdmin(request);
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
    where.push("(lower(email) LIKE ? OR lower(name) LIKE ? OR id = ?)");
    params.push(`%${q}%`, `%${q}%`, q);
  }

  const humans = await db
    .prepare(
      `SELECT id, name, email, country, location, status, created_at, deleted_at
       FROM humans
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY created_at DESC
       LIMIT 200`
    )
    .all(...params);

  const qSql = q ? "AND (lower(email) LIKE ? OR lower(name) LIKE ?)" : "";
  const oauthUsers = await db
    .prepare(
      `SELECT email, name, first_seen_at
       FROM oauth_users
       WHERE NOT EXISTS (
         SELECT 1
         FROM humans h
         WHERE lower(h.email) = lower(oauth_users.email)
           AND h.deleted_at IS NULL
       )
       ${qSql}
       ORDER BY first_seen_at DESC
       LIMIT 200`
    )
    .all(...(q ? [`%${q}%`, `%${q}%`] : []));

  const provisionalHumans = oauthUsers.map((row: any) => ({
    id: `oauth:${row.email}`,
    name: row.name || "(oauth user)",
    email: row.email,
    country: null,
    location: null,
    status: "provisional",
    created_at: row.first_seen_at,
    deleted_at: null,
    is_provisional: true
  }));

  const normalHumans = humans.map((row: any) => ({ ...row, is_provisional: false }));

  return NextResponse.json({ humans: [...normalHumans, ...provisionalHumans] });
}

export async function DELETE(request: Request) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const payload: any = await request.json().catch(() => ({}));
  const id = normalizeText(payload?.id);
  const email = normalizeText(payload?.email).toLowerCase();
  const oauthEmail = id.startsWith("oauth:") ? id.slice("oauth:".length).trim().toLowerCase() : "";
  const targetEmail = email || oauthEmail;
  if (!id && !email) {
    return NextResponse.json({ status: "error", reason: "invalid_request" }, { status: 400 });
  }

  const db = getDb();
  if (targetEmail) {
    const activeHuman = await db
      .prepare(
        `SELECT id FROM humans
         WHERE lower(email) = ? AND deleted_at IS NULL
         ORDER BY created_at DESC
         LIMIT 1`
      )
      .get<{ id: string }>(targetEmail);
    if (!activeHuman?.id) {
      const oauthUser = await db
        .prepare(`SELECT email FROM oauth_users WHERE lower(email) = ? LIMIT 1`)
        .get<{ email: string }>(targetEmail);
      if (!oauthUser?.email) {
        return NextResponse.json({ status: "not_found" }, { status: 404 });
      }
      await db.prepare(`DELETE FROM oauth_users WHERE lower(email) = ?`).run(targetEmail);
      return NextResponse.json({ status: "deleted_provisional", email: targetEmail });
    }
  }

  const humanId = id.startsWith("oauth:") ? "" : id;
  const human = await db
    .prepare(
      humanId
        ? `SELECT id, status FROM humans WHERE id = ? AND deleted_at IS NULL`
        : `SELECT id, status FROM humans WHERE lower(email) = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1`
    )
    .get(humanId ? humanId : targetEmail);
  if (!human?.id) {
    return NextResponse.json({ status: "not_found" }, { status: 404 });
  }

  const now = new Date().toISOString();

  // Best-effort cleanup: any accepted tasks assigned to this human are failed & unassigned.
  const accepted = await db
    .prepare(
      `SELECT id FROM tasks
       WHERE human_id = ? AND deleted_at IS NULL AND status = 'accepted'`
    )
    .all(human.id);

  for (const task of accepted) {
    await db
      .prepare(
        `UPDATE tasks
         SET status = 'failed', failure_reason = 'missing_human', human_id = NULL
         WHERE id = ?`
      )
      .run(task.id);
    await closeContactChannel(db, task.id);
  }

  await db
    .prepare(`UPDATE humans SET deleted_at = ?, status = 'available' WHERE id = ?`)
    .run(now, human.id);

  return NextResponse.json({ status: "deleted", id: human.id, deleted_at: now });
}

export async function PATCH(request: Request) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const payload: any = await request.json().catch(() => ({}));
  const id = normalizeText(payload?.id);
  if (!id) {
    return NextResponse.json({ status: "error", reason: "invalid_request" }, { status: 400 });
  }

  const db = getDb();
  const human = await db
    .prepare(`SELECT id FROM humans WHERE id = ?`)
    .get<{ id: string }>(id);
  if (!human?.id) {
    return NextResponse.json({ status: "not_found" }, { status: 404 });
  }

  await db.prepare(`UPDATE humans SET deleted_at = NULL WHERE id = ?`).run(id);
  return NextResponse.json({ status: "restored", id });
}
