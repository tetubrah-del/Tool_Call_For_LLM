import crypto from "crypto";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { saveUpload } from "@/lib/storage";

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

function getCurrentHumanId(email: string): string | null {
  const db = getDb();
  const row = db
    .prepare(`SELECT id FROM humans WHERE email = ? ORDER BY created_at DESC LIMIT 1`)
    .get(email) as { id: string } | undefined;
  return row?.id ?? null;
}

export async function GET() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json({ status: "unauthorized" }, { status: 401 });
  }

  const humanId = getCurrentHumanId(email);
  if (!humanId) {
    return NextResponse.json({ human_id: null, photos: [] });
  }

  const db = getDb();
  const photos = db
    .prepare(
      `SELECT id, human_id, photo_url, is_public, created_at
       FROM human_photos
       WHERE human_id = ?
       ORDER BY created_at DESC`
    )
    .all(humanId);

  return NextResponse.json({ human_id: humanId, photos });
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json({ status: "unauthorized" }, { status: 401 });
  }

  const humanId = getCurrentHumanId(email);
  if (!humanId) {
    return NextResponse.json({ status: "error", reason: "profile_not_found" }, { status: 404 });
  }

  const form = await request.formData();
  const upload = form.get("file");
  if (!(upload instanceof File)) {
    return NextResponse.json({ status: "error", reason: "missing_file" }, { status: 400 });
  }
  if (!upload.type.startsWith("image/")) {
    return NextResponse.json({ status: "error", reason: "invalid_file_type" }, { status: 400 });
  }

  const isPublic = resolveBool(form.get("is_public")) ?? false;
  const photoUrl = await saveUpload(upload);
  const photoId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const db = getDb();
  db.prepare(
    `INSERT INTO human_photos (id, human_id, photo_url, is_public, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(photoId, humanId, photoUrl, isPublic ? 1 : 0, createdAt);

  return NextResponse.json({
    status: "stored",
    photo: {
      id: photoId,
      human_id: humanId,
      photo_url: photoUrl,
      is_public: isPublic ? 1 : 0,
      created_at: createdAt
    }
  });
}
