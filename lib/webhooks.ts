import crypto from "crypto";
import type { DbClient } from "@/lib/db";
import { getNormalizedTask } from "@/lib/task-api";

export type WebhookEventType = "task.accepted" | "task.completed" | "task.failed";

type WebhookEndpoint = {
  id: string;
  ai_account_id: string;
  url: string;
  secret: string;
  status: string;
  events: string | null;
};

function wantsEvent(endpoint: WebhookEndpoint, eventType: WebhookEventType) {
  if (!endpoint.events) return true;
  const events = endpoint.events
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  return events.length === 0 || events.includes(eventType);
}

function parseTaskId(task: any): string {
  return typeof task?.id === "string" ? task.id : "";
}

export async function dispatchTaskEvent(
  db: DbClient,
  params: {
    eventType: WebhookEventType;
    taskId: string;
  }
) {
  const { eventType, taskId } = params;
  const task = await getNormalizedTask(db, taskId, "en");
  if (!task || !task.ai_account_id) return;

  const endpoints = await db
    .prepare(
      `SELECT id, ai_account_id, url, secret, status, events
       FROM webhook_endpoints
       WHERE ai_account_id = ? AND status = 'active'`
    )
    .all<WebhookEndpoint>(task.ai_account_id);

  if (!endpoints.length) return;

  const eventId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const payload = {
    id: eventId,
    type: eventType,
    created_at: createdAt,
    task
  };
  const rawPayload = JSON.stringify(payload);

  await Promise.all(
    endpoints
      .filter((endpoint) => wantsEvent(endpoint, eventType))
      .map(async (endpoint) => {
        const signature = crypto
          .createHmac("sha256", endpoint.secret)
          .update(rawPayload)
          .digest("hex");

        let statusCode: number | null = null;
        let responseBody: string | null = null;
        let error: string | null = null;

        try {
          const response = await fetch(endpoint.url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-ToolCall-Event": eventType,
              "X-ToolCall-Signature": `sha256=${signature}`
            },
            body: rawPayload
          });

          statusCode = response.status;
          responseBody = (await response.text()).slice(0, 2000);
        } catch (err: any) {
          error = typeof err?.message === "string" ? err.message : "webhook_dispatch_error";
        }

        await db.prepare(
          `INSERT INTO webhook_deliveries
           (id, webhook_id, event_id, event_type, task_id, status_code, response_body, error, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          crypto.randomUUID(),
          endpoint.id,
          eventId,
          eventType,
          parseTaskId(task),
          statusCode,
          responseBody,
          error,
          createdAt
        );
      })
  );
}

export function generateWebhookSecret() {
  return crypto.randomBytes(24).toString("hex");
}
