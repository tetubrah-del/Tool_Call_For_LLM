import crypto from "crypto";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: Request) {
  const payload = await request.json().catch(() => null);
  const humanId = normalizeText(payload?.human_id);
  const subject = normalizeText(payload?.subject);
  const body = normalizeText(payload?.body);
  const fromName = normalizeText(payload?.from_name);
  const fromEmail = normalizeText(payload?.from_email).toLowerCase();

  if (!humanId || !subject || !body) {
    return NextResponse.json({ status: "error", reason: "invalid_request" }, { status: 400 });
  }
  if (subject.length > 160 || body.length > 4000) {
    return NextResponse.json({ status: "error", reason: "invalid_request" }, { status: 400 });
  }
  if (fromEmail && !fromEmail.includes("@")) {
    return NextResponse.json({ status: "error", reason: "invalid_request" }, { status: 400 });
  }

  const db = getDb();
  const human = await db
    .prepare(`SELECT id FROM humans WHERE id = ? LIMIT 1`)
    .get(humanId) as { id: string } | undefined;
  if (!human?.id) {
    return NextResponse.json({ status: "not_found" }, { status: 404 });
  }

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  await db.prepare(
    `INSERT INTO human_inquiries (id, human_id, from_name, from_email, subject, body, is_read, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?)`
  ).run(
    id,
    humanId,
    fromName || null,
    fromEmail || null,
    subject,
    body,
    createdAt
  );

  return NextResponse.json({ status: "stored", inquiry_id: id });
}
