import type { DbClient } from "@/lib/db";
import { dispatchTaskEvent } from "@/lib/webhooks";
import { closeContactChannel } from "@/lib/contact-channel";
import { computeReviewPendingDeadline } from "@/lib/review-pending";
import { computeReviewDeadlineAt } from "@/lib/task-reviews";
import { authorizeOrderPayment, captureOrderAuthorization } from "@/lib/ai-billing";

type TaskRow = {
  id: string;
  deadline_at: string | null;
  deadline_minutes: number | null;
  review_pending_deadline_at: string | null;
  created_at: string;
  status: "open" | "accepted" | "review_pending" | "completed" | "failed";
  human_id: string | null;
  submission_id: string | null;
  ai_account_id: string | null;
};

type PaymentAuthorizationRow = {
  id: string;
  ai_account_id: string;
  order_id: string | null;
  order_version: number | null;
  task_id: string;
  status: string;
  next_retry_at: string | null;
};

type ArrearAiRow = {
  ai_account_id: string;
  overdue_minor_total: number;
};

const SWEEP_INTERVAL_MS = 60 * 1000;
const SWEEPER_KEY = "__timeout_sweeper_started__";

function parsePositiveInt(value: string | undefined, fallback: number) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function arrearsDisableThresholdMinor() {
  return parsePositiveInt(process.env.PAYMENT_ARREARS_DISABLE_THRESHOLD_MINOR, 1);
}

function paymentRetryBatchSize() {
  return parsePositiveInt(process.env.PAYMENT_CAPTURE_RETRY_BATCH_SIZE, 50);
}

function orderByTaskSweepLimit() {
  return parsePositiveInt(process.env.PAYMENT_TIMEOUT_SWEEP_LIMIT, 200);
}

function computeDeadlineAt(task: TaskRow): string | null {
  if (task.deadline_at) return task.deadline_at;
  if (task.deadline_minutes == null) return null;
  if (!Number.isFinite(task.deadline_minutes)) return null;
  const createdAt = Date.parse(task.created_at);
  if (!Number.isFinite(createdAt)) return null;
  const deadlineMs = createdAt + task.deadline_minutes * 60 * 1000;
  return new Date(deadlineMs).toISOString();
}

function isIsoDue(iso: string | null | undefined, nowMs: number) {
  if (!iso) return false;
  const dueMs = Date.parse(iso);
  if (!Number.isFinite(dueMs)) return false;
  return dueMs <= nowMs;
}

async function capturePaymentForTaskIfNeeded(
  db: DbClient,
  task: TaskRow
): Promise<{
  ok: boolean;
  settledPayment: boolean;
}> {
  const order = await db
    .prepare(
      `SELECT id, version
       FROM orders
       WHERE task_id = ?
       ORDER BY created_at DESC
       LIMIT 1`
    )
    .get<{ id: string; version: number }>(task.id);

  if (!order?.id || !task.ai_account_id) {
    // Backward compatibility for legacy tasks that predate order/auth flows.
    return { ok: true, settledPayment: false };
  }

  const auth = await db
    .prepare(
      `SELECT status, next_retry_at
       FROM payment_authorizations
       WHERE order_id = ? AND order_version = ?
       ORDER BY created_at DESC
       LIMIT 1`
    )
    .get<{ status: string; next_retry_at: string | null }>(order.id, order.version);

  const nowMs = Date.now();
  if (
    auth &&
    (auth.status === "expired" || auth.status === "canceled" ||
      ((auth.status === "capture_failed" || auth.status === "capture_pending") &&
        !isIsoDue(auth.next_retry_at, nowMs)))
  ) {
    return { ok: false, settledPayment: false };
  }

  let capture = await captureOrderAuthorization(db, {
    aiAccountId: task.ai_account_id,
    orderId: order.id,
    orderVersion: order.version
  });

  if (capture.ok === false && capture.reason === "authorization_missing") {
    const authorize = await authorizeOrderPayment(db, {
      aiAccountId: task.ai_account_id,
      orderId: order.id,
      orderVersion: order.version
    });
    if (authorize.ok === false) {
      return { ok: false, settledPayment: false };
    }
    capture = await captureOrderAuthorization(db, {
      aiAccountId: task.ai_account_id,
      orderId: order.id,
      orderVersion: order.version
    });
  }

  if (capture.ok === false) {
    return { ok: false, settledPayment: false };
  }

  return {
    ok: true,
    settledPayment: true
  };
}

async function sweepPaymentCaptureRetries(db: DbClient) {
  const now = nowIso();
  const rows = await db
    .prepare(
      `SELECT id, ai_account_id, order_id, order_version, task_id, status, next_retry_at
       FROM payment_authorizations
       WHERE status = 'capture_failed'
         AND next_retry_at IS NOT NULL
         AND next_retry_at <= ?
       ORDER BY next_retry_at ASC
       LIMIT ?`
    )
    .all<PaymentAuthorizationRow>(now, paymentRetryBatchSize());

  for (const row of rows) {
    if (!row.order_id || !Number.isInteger(Number(row.order_version))) continue;
    await captureOrderAuthorization(db, {
      aiAccountId: row.ai_account_id,
      orderId: String(row.order_id),
      orderVersion: Number(row.order_version)
    });
  }
}

async function sweepArrearsAccessControl(db: DbClient) {
  const now = nowIso();

  await db
    .prepare(
      `UPDATE payment_arrears
       SET status = 'collecting',
           updated_at = ?
       WHERE status = 'open'
         AND due_at <= ?`
    )
    .run(now, now);

  const overdueByAi = await db
    .prepare(
      `SELECT ai_account_id, COALESCE(SUM(amount_minor), 0) AS overdue_minor_total
       FROM payment_arrears
       WHERE status IN ('open', 'collecting')
         AND due_at <= ?
       GROUP BY ai_account_id`
    )
    .all<ArrearAiRow>(now);

  const threshold = arrearsDisableThresholdMinor();
  for (const row of overdueByAi) {
    if (Number(row.overdue_minor_total || 0) < threshold) continue;
    await db
      .prepare(
        `UPDATE ai_accounts
         SET api_access_status = 'disabled',
             collection_disabled_at = COALESCE(collection_disabled_at, ?)
         WHERE id = ?
           AND deleted_at IS NULL
           AND COALESCE(api_access_status, 'active') <> 'disabled'`
      )
      .run(now, row.ai_account_id);
  }
}

async function sweepTimeouts(db: DbClient) {
  await sweepPaymentCaptureRetries(db);
  await sweepArrearsAccessControl(db);

  const now = Date.now();
  const nowIsoValue = new Date(now).toISOString();
  const candidates = await db
    .prepare(
      `SELECT id, deadline_at, deadline_minutes, review_pending_deadline_at, created_at, status, human_id, submission_id, ai_account_id
       FROM tasks
       WHERE (
         status IN ('open', 'accepted')
         AND (deadline_at IS NOT NULL OR deadline_minutes IS NOT NULL)
       )
       OR status = 'review_pending'`
    )
    .all<TaskRow>();

  for (const task of candidates.slice(0, orderByTaskSweepLimit())) {
    if (task.status === "review_pending") {
      let reviewDeadlineAt = task.review_pending_deadline_at;
      if (!reviewDeadlineAt) {
        let baseIso = nowIsoValue;
        if (task.submission_id) {
          const submission = await db
            .prepare(`SELECT created_at FROM submissions WHERE id = ?`)
            .get<{ created_at: string }>(task.submission_id);
          if (submission?.created_at) baseIso = submission.created_at;
        }
        reviewDeadlineAt = computeReviewPendingDeadline(baseIso);
        await db
          .prepare(`UPDATE tasks SET review_pending_deadline_at = ? WHERE id = ?`)
          .run(reviewDeadlineAt, task.id);
      }

      const reviewDeadlineMs = Date.parse(reviewDeadlineAt);
      if (!Number.isFinite(reviewDeadlineMs) || now <= reviewDeadlineMs) {
        continue;
      }

      const capture = await capturePaymentForTaskIfNeeded(db, task);
      if (!capture.ok) {
        continue;
      }

      const completedAt = nowIso();
      const updated = await db
        .prepare(
          capture.settledPayment
            ? `UPDATE tasks
               SET status = 'completed',
                   review_pending_deadline_at = NULL,
                   completed_at = ?,
                   review_deadline_at = ?,
                   paid_status = 'paid',
                   paid_at = ?,
                   paid_method = 'stripe',
                   payment_error_message = NULL
               WHERE id = ? AND status = 'review_pending'`
            : `UPDATE tasks
               SET status = 'completed',
                   review_pending_deadline_at = NULL,
                   completed_at = ?,
                   review_deadline_at = ?
               WHERE id = ? AND status = 'review_pending'`
        )
        .run(
          completedAt,
          computeReviewDeadlineAt(completedAt),
          ...(capture.settledPayment ? [completedAt, task.id] : [task.id])
        );
      if (updated > 0) {
        void dispatchTaskEvent(db, { eventType: "task.completed", taskId: task.id }).catch(() => {});
      }
      continue;
    }

    const deadlineAt = computeDeadlineAt(task);
    if (!deadlineAt) continue;
    const deadlineMs = Date.parse(deadlineAt);
    if (!Number.isFinite(deadlineMs) || now <= deadlineMs) continue;

    await db.prepare(
      `UPDATE tasks
       SET status = 'failed', failure_reason = 'timeout', deadline_at = ?
       WHERE id = ?`
    ).run(deadlineAt, task.id);

    await closeContactChannel(db, task.id);
    void dispatchTaskEvent(db, { eventType: "task.failed", taskId: task.id }).catch(() => {});
  }
}

function nowIso() {
  return new Date().toISOString();
}

export function startTimeoutSweeper(db: DbClient) {
  const g = globalThis as typeof globalThis & { [SWEEPER_KEY]?: boolean };
  if (g[SWEEPER_KEY]) return;
  g[SWEEPER_KEY] = true;

  setInterval(() => {
    void sweepTimeouts(db).catch((error) => {
      console.error("timeout_sweeper_error", error);
    });
  }, SWEEP_INTERVAL_MS).unref?.();
}
