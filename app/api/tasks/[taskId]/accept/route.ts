import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { dispatchTaskEvent } from "@/lib/webhooks";
import { ensurePendingContactChannel } from "@/lib/contact-channel";

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(
  request: Request,
  { params }: { params: { taskId: string } }
) {
  // This endpoint is intentionally AI-only.
  // Humans should apply first; AI selects an applicant to accept.
  const payload = await request.json().catch(() => null);
  const aiAccountId = normalizeText(payload?.ai_account_id);
  const aiApiKey = normalizeText(payload?.ai_api_key);
  const selectedHumanId = normalizeText(payload?.human_id);

  if (!aiAccountId || !aiApiKey || !selectedHumanId) {
    return NextResponse.json({ status: "error", reason: "invalid_request" }, { status: 400 });
  }

  const db = getDb();

  const aiAccount = await db
    .prepare(`SELECT id, api_key, status FROM ai_accounts WHERE id = ?`)
    .get<{ id: string; api_key: string; status: string }>(aiAccountId);
  if (!aiAccount?.id || aiAccount.api_key !== aiApiKey || aiAccount.status !== "active") {
    return NextResponse.json({ status: "unauthorized" }, { status: 401 });
  }

  const task = await db
    .prepare(`SELECT id, status, human_id, ai_account_id FROM tasks WHERE id = ?`)
    .get<{ id: string; status: string; human_id: string | null; ai_account_id: string | null }>(
      params.taskId
    );
  if (!task?.id) {
    return NextResponse.json({ status: "not_found" }, { status: 404 });
  }
  if (!task.ai_account_id || task.ai_account_id !== aiAccountId) {
    return NextResponse.json({ status: "unauthorized" }, { status: 401 });
  }
  if (task.status !== "open") {
    return NextResponse.json({ status: "error", reason: "not_open" }, { status: 409 });
  }
  if (task.human_id) {
    return NextResponse.json({ status: "error", reason: "already_assigned" }, { status: 409 });
  }

  const application = await db
    .prepare(`SELECT id FROM task_applications WHERE task_id = ? AND human_id = ?`)
    .get<{ id: string }>(params.taskId, selectedHumanId);
  if (!application?.id) {
    return NextResponse.json({ status: "error", reason: "not_applied" }, { status: 409 });
  }

  const human = await db
    .prepare(`SELECT id, paypal_email, status FROM humans WHERE id = ?`)
    .get<{ id: string; paypal_email: string | null; status: string }>(selectedHumanId);
  if (!human?.id) {
    return NextResponse.json({ status: "not_found" }, { status: 404 });
  }
  if (!human.paypal_email) {
    return NextResponse.json({ status: "error", reason: "invalid_request" }, { status: 400 });
  }
  if (human.status !== "available") {
    return NextResponse.json({ status: "error", reason: "human_not_available" }, { status: 409 });
  }

  // Accept (assign) the selected applicant.
  await db
    .prepare(
      `UPDATE tasks SET status = 'accepted', human_id = ?, payee_paypal_email = ? WHERE id = ?`
    )
    .run(selectedHumanId, human.paypal_email, params.taskId);
  await db.prepare(`UPDATE humans SET status = 'busy' WHERE id = ?`).run(selectedHumanId);

  // Ensure the channel exists as pending. AI must explicitly "allow" to open.
  await ensurePendingContactChannel(db, params.taskId);

  // For future: store selected application_id on task; v0 does not persist selection metadata.
  void dispatchTaskEvent(db, { eventType: "task.accepted", taskId: params.taskId }).catch(
    () => {}
  );

  return NextResponse.json({
    status: "accepted",
    task_id: params.taskId,
    application_id: application.id
  });
}
