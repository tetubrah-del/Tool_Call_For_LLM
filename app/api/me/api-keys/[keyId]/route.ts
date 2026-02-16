import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getCurrentHumanIdByEmail } from "@/lib/human-session";

async function resolveSessionHumanId() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return null;
  return getCurrentHumanIdByEmail(email);
}

export async function DELETE(
  _request: Request,
  { params }: any
) {
  const humanId = await resolveSessionHumanId();
  if (!humanId) return NextResponse.json({ status: "unauthorized" }, { status: 401 });

  const keyId = (params.keyId || "").trim();
  if (!keyId) {
    return NextResponse.json({ status: "error", reason: "invalid_request" }, { status: 400 });
  }

  const db = getDb();
  const existing = await db
    .prepare(
      `SELECT id
       FROM human_api_keys
       WHERE id = ? AND human_id = ?`
    )
    .get<{ id: string }>(keyId, humanId);
  if (!existing?.id) return NextResponse.json({ status: "not_found" }, { status: 404 });

  await db
    .prepare(
      `UPDATE human_api_keys
       SET status = 'revoked', revoked_at = ?
       WHERE id = ? AND human_id = ?`
    )
    .run(new Date().toISOString(), keyId, humanId);

  return NextResponse.json({ status: "revoked", id: keyId });
}
