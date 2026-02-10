import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { openContactChannel } from "@/lib/contact-channel";
import { verifyAiActor } from "../_auth";

export async function POST(
  request: Request,
  { params }: { params: { taskId: string } }
) {
  const payload = await request.json().catch(() => null);
  const aiAccountId =
    typeof payload?.ai_account_id === "string" ? payload.ai_account_id.trim() : "";
  const aiApiKey =
    typeof payload?.ai_api_key === "string" ? payload.ai_api_key.trim() : "";

  const db = getDb();
  const aiActor = await verifyAiActor(db, aiAccountId, aiApiKey);
  if (!aiActor) {
    return NextResponse.json({ status: "error", reason: "invalid_request" }, { status: 400 });
  }

  const task = await db
    .prepare(`SELECT id, ai_account_id, human_id, status FROM tasks WHERE id = ? AND deleted_at IS NULL`)
    .get(params.taskId) as
    | { id: string; ai_account_id: string | null; human_id: string | null; status: string }
    | undefined;
  if (!task?.id) {
    return NextResponse.json({ status: "not_found" }, { status: 404 });
  }
  if (task.ai_account_id !== aiActor.id) {
    return NextResponse.json({ status: "error", reason: "invalid_request" }, { status: 400 });
  }
  if (!task.human_id || task.status !== "accepted") {
    return NextResponse.json(
      { status: "error", reason: "contact_not_ready" },
      { status: 409 }
    );
  }

  await openContactChannel(db, task.id);

  return NextResponse.json({ status: "open", task_id: task.id });
}
