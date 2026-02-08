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

  const humanId = getCurrentHumanIdByEmail(email);
  if (!humanId) {
    return NextResponse.json({ human_id: null, inquiries: [], templates: [] });
  }

  const db = getDb();
  const inquiries = db
    .prepare(
      `SELECT id, human_id, from_name, from_email, subject, body, COALESCE(is_read, 0) AS is_read, created_at
       FROM human_inquiries
       WHERE human_id = ?
       ORDER BY created_at DESC`
    )
    .all(humanId);
  const templates = db
    .prepare(
      `SELECT id, human_id, title, body, created_at, updated_at
       FROM message_templates
       WHERE human_id = ?
       ORDER BY updated_at DESC`
    )
    .all(humanId);

  return NextResponse.json({
    human_id: humanId,
    inquiries,
    templates
  });
}
