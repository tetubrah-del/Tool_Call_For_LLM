import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getCurrentHumanIdByEmail } from "@/lib/human-session";

function resolveBool(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1") return true;
    if (normalized === "false" || normalized === "0") return false;
  }
  return null;
}

export async function PATCH(
  request: Request,
  { params }: { params: { inquiryId: string } }
) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json({ status: "unauthorized" }, { status: 401 });
  }

  const humanId = getCurrentHumanIdByEmail(email);
  if (!humanId) {
    return NextResponse.json({ status: "error", reason: "profile_not_found" }, { status: 404 });
  }

  const payload = await request.json().catch(() => null);
  const isRead = resolveBool(payload?.is_read);
  if (isRead === null) {
    return NextResponse.json({ status: "error", reason: "invalid_request" }, { status: 400 });
  }

  const db = getDb();
  const current = db
    .prepare(`SELECT id FROM human_inquiries WHERE id = ? AND human_id = ?`)
    .get(params.inquiryId, humanId) as { id: string } | undefined;
  if (!current?.id) {
    return NextResponse.json({ status: "not_found" }, { status: 404 });
  }

  db.prepare(`UPDATE human_inquiries SET is_read = ? WHERE id = ?`).run(
    isRead ? 1 : 0,
    params.inquiryId
  );

  return NextResponse.json({
    status: "updated",
    id: params.inquiryId,
    is_read: isRead ? 1 : 0
  });
}
