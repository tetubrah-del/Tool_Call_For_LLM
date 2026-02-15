import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { authenticateHumanRequest, finalizeHumanAuthResponse } from "@/lib/human-api-auth";

type SettingsRow = {
  human_id: string;
  email_enabled: number;
  notify_task_accepted: number;
  notify_ai_message: number;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  timezone: string | null;
};

function normalizeBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1" || value === "true") return true;
  if (value === 0 || value === "0" || value === "false") return false;
  return null;
}

async function ensureSettings(db: ReturnType<typeof getDb>, humanId: string) {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO human_notification_settings
       (human_id, email_enabled, notify_task_accepted, notify_ai_message, created_at, updated_at)
       VALUES (?, 1, 1, 1, ?, ?)
       ON CONFLICT(human_id) DO NOTHING`
    )
    .run(humanId, now, now);
}

function formatRow(row: SettingsRow) {
  return {
    human_id: row.human_id,
    email_enabled: Boolean(row.email_enabled),
    notify_task_accepted: Boolean(row.notify_task_accepted),
    notify_ai_message: Boolean(row.notify_ai_message),
    quiet_hours_start: row.quiet_hours_start,
    quiet_hours_end: row.quiet_hours_end,
    timezone: row.timezone
  };
}

export async function GET(request: Request) {
  const auth = await authenticateHumanRequest(request, "profile:read");
  if (auth.ok === false) return auth.response;

  const db = getDb();
  await ensureSettings(db, auth.humanId);
  const row = await db
    .prepare(
      `SELECT human_id, email_enabled, notify_task_accepted, notify_ai_message, quiet_hours_start, quiet_hours_end, timezone
       FROM human_notification_settings
       WHERE human_id = ?`
    )
    .get<SettingsRow>(auth.humanId);
  const response = NextResponse.json({
    settings: row ? formatRow(row) : null
  });
  return finalizeHumanAuthResponse(request, response, auth);
}

export async function PATCH(request: Request) {
  const auth = await authenticateHumanRequest(request, "profile:read");
  if (auth.ok === false) return auth.response;

  const payload: any = await request.json().catch(() => null);
  const emailEnabled = normalizeBoolean(payload?.email_enabled);
  const notifyTaskAccepted = normalizeBoolean(payload?.notify_task_accepted);
  const notifyAiMessage = normalizeBoolean(payload?.notify_ai_message);

  if (emailEnabled === null && notifyTaskAccepted === null && notifyAiMessage === null) {
    const bad = NextResponse.json({ status: "error", reason: "invalid_request" }, { status: 400 });
    return finalizeHumanAuthResponse(request, bad, auth);
  }

  const db = getDb();
  await ensureSettings(db, auth.humanId);
  const existing = await db
    .prepare(
      `SELECT human_id, email_enabled, notify_task_accepted, notify_ai_message, quiet_hours_start, quiet_hours_end, timezone
       FROM human_notification_settings
       WHERE human_id = ?`
    )
    .get<SettingsRow>(auth.humanId);
  if (!existing?.human_id) {
    const notFound = NextResponse.json({ status: "not_found" }, { status: 404 });
    return finalizeHumanAuthResponse(request, notFound, auth);
  }

  const nextEmailEnabled = emailEnabled === null ? existing.email_enabled : emailEnabled ? 1 : 0;
  const nextNotifyTaskAccepted =
    notifyTaskAccepted === null ? existing.notify_task_accepted : notifyTaskAccepted ? 1 : 0;
  const nextNotifyAiMessage =
    notifyAiMessage === null ? existing.notify_ai_message : notifyAiMessage ? 1 : 0;
  const now = new Date().toISOString();

  await db
    .prepare(
      `UPDATE human_notification_settings
       SET email_enabled = ?,
           notify_task_accepted = ?,
           notify_ai_message = ?,
           updated_at = ?
       WHERE human_id = ?`
    )
    .run(
      nextEmailEnabled,
      nextNotifyTaskAccepted,
      nextNotifyAiMessage,
      now,
      auth.humanId
    );

  const response = NextResponse.json({
    status: "updated",
    settings: {
      human_id: auth.humanId,
      email_enabled: Boolean(nextEmailEnabled),
      notify_task_accepted: Boolean(nextNotifyTaskAccepted),
      notify_ai_message: Boolean(nextNotifyAiMessage),
      quiet_hours_start: existing.quiet_hours_start,
      quiet_hours_end: existing.quiet_hours_end,
      timezone: existing.timezone
    }
  });
  return finalizeHumanAuthResponse(request, response, auth);
}
