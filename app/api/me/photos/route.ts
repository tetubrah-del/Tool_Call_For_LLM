import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getCurrentHumanIdByEmail } from "@/lib/human-session";

export async function GET() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json({ status: "unauthorized" }, { status: 401 });
  }

  const humanId = await getCurrentHumanIdByEmail(email);
  if (!humanId) {
    return NextResponse.json({ human_id: null, photos: [] });
  }

  const db = getDb();
  const photos = await db
    .prepare(
      `SELECT id, human_id, photo_url, is_public, created_at
       FROM human_photos
       WHERE human_id = ?
       ORDER BY created_at DESC`
    )
    .all(humanId);

  return NextResponse.json({ human_id: humanId, photos });
}

export async function POST() {
  return NextResponse.json(
    { status: "error", reason: "photo_feature_disabled" },
    { status: 410 }
  );
}
