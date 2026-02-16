import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { deleteUpload } from "@/lib/storage";
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
  context: { params: Promise<{ photoId: string }> }
) {
  const { photoId } = await context.params;
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
  const isPublic = resolveBool(payload?.is_public);
  if (isPublic === null) {
    return NextResponse.json({ status: "error", reason: "invalid_request" }, { status: 400 });
  }

  const db = getDb();
  const current = await db
    .prepare(`SELECT id FROM human_photos WHERE id = ? AND human_id = ?`)
    .get(photoId, humanId) as { id: string } | undefined;
  if (!current?.id) {
    return NextResponse.json({ status: "not_found" }, { status: 404 });
  }

  await db.prepare(`UPDATE human_photos SET is_public = ? WHERE id = ?`).run(
    isPublic ? 1 : 0,
    photoId
  );

  return NextResponse.json({ status: "updated", id: photoId, is_public: isPublic ? 1 : 0 });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ photoId: string }> }
) {
  const { photoId } = await context.params;
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
    .prepare(`SELECT id, photo_url FROM human_photos WHERE id = ? AND human_id = ?`)
    .get(photoId, humanId) as { id: string; photo_url: string } | undefined;
  if (!current?.id) {
    return NextResponse.json({ status: "not_found" }, { status: 404 });
  }

  await db.prepare(`DELETE FROM human_photos WHERE id = ?`).run(photoId);
  deleteUpload(current.photo_url);

  return NextResponse.json({ status: "deleted", id: photoId });
}
