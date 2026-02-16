import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getCurrentHumanIdByEmail } from "@/lib/human-session";

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ templateId: string }> }
) {
  const { templateId } = await context.params;
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json({ status: "unauthorized" }, { status: 401 });
  }

  const humanId = await getCurrentHumanIdByEmail(email);
  if (!humanId) {
    return NextResponse.json({ status: "error", reason: "profile_not_found" }, { status: 404 });
  }

  const payload = await request.json().catch(() => null);
  const title = normalizeText(payload?.title);
  const body = normalizeText(payload?.body);
  if (!title || !body) {
    return NextResponse.json({ status: "error", reason: "invalid_request" }, { status: 400 });
  }
  if (title.length > 120 || body.length > 4000) {
    return NextResponse.json({ status: "error", reason: "invalid_request" }, { status: 400 });
  }

  const db = getDb();
  const current = await db
    .prepare(`SELECT id FROM message_templates WHERE id = ? AND human_id = ?`)
    .get(templateId, humanId) as { id: string } | undefined;
  if (!current?.id) {
    return NextResponse.json({ status: "not_found" }, { status: 404 });
  }

  const now = new Date().toISOString();
  await db.prepare(`UPDATE message_templates SET title = ?, body = ?, updated_at = ? WHERE id = ?`).run(
    title,
    body,
    now,
    templateId
  );

  return NextResponse.json({ status: "updated", id: templateId, title, body, updated_at: now });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ templateId: string }> }
) {
  const { templateId } = await context.params;
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json({ status: "unauthorized" }, { status: 401 });
  }

  const humanId = await getCurrentHumanIdByEmail(email);
  if (!humanId) {
    return NextResponse.json({ status: "error", reason: "profile_not_found" }, { status: 404 });
  }

  const db = getDb();
  const current = await db
    .prepare(`SELECT id FROM message_templates WHERE id = ? AND human_id = ?`)
    .get(templateId, humanId) as { id: string } | undefined;
  if (!current?.id) {
    return NextResponse.json({ status: "not_found" }, { status: 404 });
  }

  await db.prepare(`DELETE FROM message_templates WHERE id = ?`).run(templateId);
  return NextResponse.json({ status: "deleted", id: templateId });
}
