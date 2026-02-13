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
    return NextResponse.json({ human_id: null, inquiries: [], templates: [] });
  }

  const db = getDb();
  const channels = await db
    .prepare(
      `SELECT
         tc.task_id,
         tc.status,
         tc.opened_at,
         tc.closed_at,
         t.task,
         t.task_en,
         t.status AS task_status,
         t.created_at,
         (
           SELECT COUNT(*)
           FROM contact_messages cm
           WHERE cm.task_id = tc.task_id AND cm.read_by_human = 0
         ) AS unread_count,
         (
           SELECT COUNT(*)
           FROM contact_messages cm
           WHERE cm.task_id = tc.task_id
         ) AS message_count
       FROM task_contacts tc
       JOIN tasks t ON t.id = tc.task_id
       WHERE tc.human_id = ? AND t.deleted_at IS NULL
       ORDER BY t.created_at DESC`
    )
    .all(humanId);

  return NextResponse.json({
    human_id: humanId,
    channels
  });
}
