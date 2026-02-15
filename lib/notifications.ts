import crypto from "crypto";
import type { DbClient } from "@/lib/db";

type NotificationSettingRow = {
  human_id: string;
  email_enabled: number;
  notify_task_accepted: number;
  notify_ai_message: number;
};

type HumanRow = {
  id: string;
  name: string | null;
  email: string | null;
  country?: string | null;
};

type TaskRow = {
  id: string;
  task: string;
  task_en: string | null;
};

function baseUrl() {
  return (process.env.APP_BASE_URL || process.env.NEXTAUTH_URL || "http://localhost:3000").replace(
    /\/+$/,
    ""
  );
}

function nowIso() {
  return new Date().toISOString();
}

function isJapaneseCountry(country: string | null | undefined) {
  return (country || "").trim().toUpperCase() === "JP";
}

async function ensureNotificationSettings(db: DbClient, humanId: string) {
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO human_notification_settings
       (human_id, email_enabled, notify_task_accepted, notify_ai_message, created_at, updated_at)
       VALUES (?, 1, 1, 1, ?, ?)
       ON CONFLICT(human_id) DO NOTHING`
    )
    .run(humanId, now, now);
}

async function loadSettings(db: DbClient, humanId: string): Promise<NotificationSettingRow | null> {
  await ensureNotificationSettings(db, humanId);
  return db
    .prepare(
      `SELECT human_id, email_enabled, notify_task_accepted, notify_ai_message
       FROM human_notification_settings
       WHERE human_id = ?`
    )
    .get<NotificationSettingRow>(humanId);
}

async function enqueueEmailDelivery(
  db: DbClient,
  params: {
    eventType: "task.accepted.human" | "task.message.ai_to_human";
    taskId: string;
    humanId: string;
    idempotencyKey: string;
    templateKey: "task_accepted_human" | "ai_message_received";
    subject: string;
    bodyText: string;
    payload: Record<string, any>;
  }
) {
  const human = await db
    .prepare(`SELECT id, name, email FROM humans WHERE id = ? AND deleted_at IS NULL`)
    .get<HumanRow>(params.humanId);
  if (!human?.id || !human.email) return;

  const createdAt = nowIso();
  const eventId = crypto.randomUUID();
  const inserted = await db
    .prepare(
      `INSERT INTO notification_events
       (id, event_type, task_id, human_id, idempotency_key, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(idempotency_key) DO NOTHING`
    )
    .run(
      eventId,
      params.eventType,
      params.taskId,
      params.humanId,
      params.idempotencyKey,
      JSON.stringify(params.payload),
      createdAt
    );
  if (inserted < 1) return;

  await db
    .prepare(
      `INSERT INTO email_deliveries
       (id, event_id, to_email, template_key, subject, body_text, status, attempt_count, next_attempt_at, provider_message_id, last_error, created_at, updated_at, sent_at)
       VALUES (?, ?, ?, ?, ?, ?, 'queued', 0, ?, NULL, NULL, ?, ?, NULL)`
    )
    .run(
      crypto.randomUUID(),
      eventId,
      human.email,
      params.templateKey,
      params.subject,
      params.bodyText,
      createdAt,
      createdAt,
      createdAt
    );
}

export async function queueTaskAcceptedHumanNotification(
  db: DbClient,
  params: {
    taskId: string;
    humanId: string;
  }
) {
  const settings = await loadSettings(db, params.humanId);
  if (!settings?.email_enabled || !settings.notify_task_accepted) return;

  const task = await db
    .prepare(`SELECT id, task, task_en FROM tasks WHERE id = ? AND deleted_at IS NULL`)
    .get<TaskRow>(params.taskId);
  if (!task?.id) return;
  const human = await db
    .prepare(`SELECT id, country FROM humans WHERE id = ? AND deleted_at IS NULL`)
    .get<HumanRow>(params.humanId);
  const useJa = isJapaneseCountry(human?.country);

  const title = (task.task_en || task.task || "").trim();
  const taskUrl = `${baseUrl()}/tasks/${encodeURIComponent(task.id)}`;
  const subject = useJa
    ? `[Sinkai] 応募が受諾されました: ${title || task.id}`
    : `[Sinkai] Task accepted: ${title || task.id}`;
  const bodyText = useJa
    ? [
        "応募したタスクが受諾されました。",
        "",
        `タスク: ${title || task.id}`,
        `タスクURL: ${taskUrl}`
      ].join("\n")
    : [
        "Your application was accepted.",
        "",
        `Task: ${title || task.id}`,
        `Task URL: ${taskUrl}`
      ].join("\n");

  await enqueueEmailDelivery(db, {
    eventType: "task.accepted.human",
    taskId: task.id,
    humanId: params.humanId,
    idempotencyKey: `task:${task.id}:accepted:human:${params.humanId}`,
    templateKey: "task_accepted_human",
    subject,
    bodyText,
    payload: {
      task_id: task.id,
      task_title: title,
      task_url: taskUrl
    }
  });
}

export async function queueAiMessageHumanNotification(
  db: DbClient,
  params: {
    taskId: string;
    humanId: string;
    messageId: string;
    messageBody: string;
  }
) {
  const settings = await loadSettings(db, params.humanId);
  if (!settings?.email_enabled || !settings.notify_ai_message) return;

  const task = await db
    .prepare(`SELECT id, task, task_en FROM tasks WHERE id = ? AND deleted_at IS NULL`)
    .get<TaskRow>(params.taskId);
  if (!task?.id) return;
  const human = await db
    .prepare(`SELECT id, country FROM humans WHERE id = ? AND deleted_at IS NULL`)
    .get<HumanRow>(params.humanId);
  const useJa = isJapaneseCountry(human?.country);

  const title = (task.task_en || task.task || "").trim();
  const messageUrl = `${baseUrl()}/me?tab=messages&task_id=${encodeURIComponent(task.id)}`;
  const excerpt = (params.messageBody || "").trim().slice(0, 160);
  const subject = useJa
    ? `[Sinkai] AIから新しいメッセージ: ${title || task.id}`
    : `[Sinkai] New AI message: ${title || task.id}`;
  const bodyText = (
    useJa
      ? [
          "AIから新しいメッセージを受信しました。",
          "",
          `タスク: ${title || task.id}`,
          excerpt ? `メッセージ: ${excerpt}` : null,
          `メッセージを開く: ${messageUrl}`
        ]
      : [
          "You received a new message from AI.",
          "",
          `Task: ${title || task.id}`,
          excerpt ? `Message: ${excerpt}` : null,
          `Open messages: ${messageUrl}`
        ]
  )
    .filter(Boolean)
    .join("\n");

  await enqueueEmailDelivery(db, {
    eventType: "task.message.ai_to_human",
    taskId: task.id,
    humanId: params.humanId,
    idempotencyKey: `message:${params.messageId}`,
    templateKey: "ai_message_received",
    subject,
    bodyText,
    payload: {
      task_id: task.id,
      task_title: title,
      message_id: params.messageId,
      message_excerpt: excerpt,
      message_url: messageUrl
    }
  });
}
