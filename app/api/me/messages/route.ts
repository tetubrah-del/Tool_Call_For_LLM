import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { authenticateHumanRequest, finalizeHumanAuthResponse } from "@/lib/human-api-auth";

export async function GET(request: Request) {
  const auth = await authenticateHumanRequest(request, "messages:read");
  if (auth.ok === false) return auth.response;

  let response: NextResponse;
  try {
    const humanId = auth.humanId;
    if (!humanId) {
      response = NextResponse.json({ human_id: null, inquiries: [], templates: [] });
      return await finalizeHumanAuthResponse(request, response, auth);
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
             SELECT MAX(cm.created_at)
             FROM contact_messages cm
             WHERE cm.task_id = tc.task_id
           ) AS last_message_at,
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
         ORDER BY
           COALESCE(
             (
               SELECT MAX(cm.created_at)
               FROM contact_messages cm
               WHERE cm.task_id = tc.task_id
             ),
             t.created_at
           ) DESC`
      )
      .all(humanId);

    response = NextResponse.json({
      human_id: humanId,
      channels
    });
  } catch {
    response = NextResponse.json({ status: "error", reason: "internal_error" }, { status: 500 });
  }

  return finalizeHumanAuthResponse(request, response, auth);
}
