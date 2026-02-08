import crypto from "crypto";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getCurrentHumanIdByEmail } from "@/lib/human-session";

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: Request) {
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

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const db = getDb();
  await db.prepare(
    `INSERT INTO message_templates (id, human_id, title, body, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, humanId, title, body, now, now);

  return NextResponse.json({
    status: "stored",
    template: {
      id,
      human_id: humanId,
      title,
      body,
      created_at: now,
      updated_at: now
    }
  });
}
