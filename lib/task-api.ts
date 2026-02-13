import type { DbClient, FailureReason, Task, Submission } from "@/lib/db";
import { normalizeLang, type UiLang } from "@/lib/i18n";
import { normalizeTaskLabel, type TaskLabel } from "@/lib/task-labels";
import { closeContactChannel } from "@/lib/contact-channel";
import { normalizePaymentStatus, type PaymentStatus } from "@/lib/payments";

type NormalizedSubmission =
  | (Submission & { id: string })
  | null;

export type NormalizedTask = {
  id: string;
  task: string;
  task_display: string;
  lang: UiLang;
  location: string | null;
  budget_usd: number;
  origin_country: string | null;
  task_label: TaskLabel | null;
  acceptance_criteria: string | null;
  not_allowed: string | null;
  ai_account_id: string | null;
  payer_paypal_email: string | null;
  payee_paypal_email: string | null;
  deliverable: "photo" | "video" | "text";
  deadline_at: string | null;
  review_pending_deadline_at: string | null;
  status: "open" | "accepted" | "review_pending" | "completed" | "failed";
  failure_reason: FailureReason | null;
  human_id: string | null;
  created_at: string;
  submission: NormalizedSubmission;
  paid_status: PaymentStatus;
  approved_at: string | null;
  paid_at: string | null;
  paid_method: "paypal" | "stripe" | null;
  fee_rate: number | null;
  fee_amount: number | null;
  payout_amount: number | null;
  paypal_fee_amount: number | null;
  payout_batch_id: string | null;
  payment_error_message: string | null;
};

// Task lifecycle:
// open -> accepted -> review_pending -> completed
// open -> failed
// accepted -> failed
const FAILURE_REASONS = new Set<FailureReason>([
  "no_human_available",
  "timeout",
  "invalid_request",
  "below_min_budget",
  "missing_origin_country",
  "wrong_deliverable",
  "already_assigned",
  "not_assigned",
  "requester_rejected",
  "missing_human",
  "not_found",
  "unknown"
]);

function normalizeFailureReason(
  value: string | null,
  status: Task["status"]
): FailureReason | null {
  if (!value) {
    return status === "failed" ? "unknown" : null;
  }
  if (FAILURE_REASONS.has(value as FailureReason)) {
    return value as FailureReason;
  }
  return "unknown";
}

function computeDeadlineAt(task: Task): string | null {
  if (task.deadline_at) return task.deadline_at;
  if (task.deadline_minutes == null) return null;
  if (!Number.isFinite(task.deadline_minutes)) return null;
  const createdAt = Date.parse(task.created_at);
  if (!Number.isFinite(createdAt)) return null;
  const deadlineMs = createdAt + task.deadline_minutes * 60 * 1000;
  return new Date(deadlineMs).toISOString();
}

async function fetchSubmission(
  db: DbClient,
  task: Task
): Promise<NormalizedSubmission> {
  if (task.submission_id) {
    const submission = await db
      .prepare(`SELECT * FROM submissions WHERE id = ?`)
      .get<Submission>(task.submission_id);
    return submission || null;
  }

  const submission = await db
    .prepare(
      `SELECT * FROM submissions WHERE task_id = ? ORDER BY created_at DESC LIMIT 1`
    )
    .get<Submission>(task.id);
  return submission || null;
}

async function applyTimeoutIfNeeded(
  db: DbClient,
  task: Task,
  deadlineAt: string | null
): Promise<Task> {
  if (!deadlineAt) return task;
  if (
    task.status === "review_pending" ||
    task.status === "completed" ||
    task.status === "failed"
  ) {
    return task;
  }

  const deadlineMs = Date.parse(deadlineAt);
  if (!Number.isFinite(deadlineMs)) return task;
  if (Date.now() <= deadlineMs) return task;

  await db.prepare(
    `UPDATE tasks SET status = 'failed', failure_reason = 'timeout', deadline_at = ? WHERE id = ?`
  ).run(deadlineAt, task.id);
  if (task.human_id) {
    await db.prepare(`UPDATE humans SET status = 'available' WHERE id = ?`).run(
      task.human_id
    );
  }
  await closeContactChannel(db, task.id);

  const updated: Task = {
    ...task,
    status: "failed",
    failure_reason: "timeout",
    deadline_at: deadlineAt
  };
  return updated;
}

async function ensureTaskEnglish(db: DbClient, task: Task): Promise<string> {
  const taskEn = task.task_en || task.task;
  if (!task.task_en) {
    await db.prepare(`UPDATE tasks SET task_en = ? WHERE id = ?`).run(taskEn, task.id);
  }
  return taskEn;
}

export async function getTaskDisplay(
  db: DbClient,
  task: Task,
  langValue: string | null
): Promise<{ display: string; lang: UiLang }> {
  const lang = normalizeLang(langValue);
  const taskEn = await ensureTaskEnglish(db, task);
  if (lang === "en") {
    return { display: taskEn, lang };
  }

  const existing = await db
    .prepare(
      `SELECT text FROM task_translations WHERE task_id = ? AND lang = ?`
    )
    .get<{ text: string }>(task.id, lang);

  if (existing?.text) {
    return { display: existing.text, lang };
  }

  const now = new Date().toISOString();
  await db.prepare(
    `INSERT INTO task_translations (task_id, lang, text, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(task.id, lang, taskEn, now, now);

  return { display: taskEn, lang };
}

export async function getNormalizedTask(
  db: DbClient,
  taskId: string,
  langValue: string | null
): Promise<NormalizedTask | null> {
  const rawTask = await db
    .prepare(`SELECT * FROM tasks WHERE id = ? AND deleted_at IS NULL`)
    .get<Task>(taskId);
  if (!rawTask) return null;

  const task = rawTask as Task;
  const deadlineAt = computeDeadlineAt(task);
  const finalTask = await applyTimeoutIfNeeded(db, task, deadlineAt);
  const submission = await fetchSubmission(db, finalTask);
  const normalizedDeliverable = finalTask.deliverable || "text";
  const { display: taskDisplay, lang } = await getTaskDisplay(
    db,
    finalTask,
    langValue
  );

  if (!finalTask.deliverable) {
    await db.prepare(`UPDATE tasks SET deliverable = 'text' WHERE id = ?`).run(
      finalTask.id
    );
  }

  const failureReason = normalizeFailureReason(
    finalTask.failure_reason,
    finalTask.status
  );

  return {
    id: finalTask.id,
    task: finalTask.task,
    task_display: taskDisplay,
    lang,
    location: finalTask.location,
    budget_usd: finalTask.budget_usd,
    origin_country: finalTask.origin_country ?? null,
    task_label: normalizeTaskLabel(finalTask.task_label),
    acceptance_criteria: finalTask.acceptance_criteria ?? null,
    not_allowed: finalTask.not_allowed ?? null,
    ai_account_id: finalTask.ai_account_id ?? null,
    payer_paypal_email: finalTask.payer_paypal_email ?? null,
    payee_paypal_email: finalTask.payee_paypal_email ?? null,
    deliverable: normalizedDeliverable,
    deadline_at: deadlineAt,
    review_pending_deadline_at: finalTask.review_pending_deadline_at ?? null,
    status: finalTask.status,
    failure_reason: failureReason,
    human_id: finalTask.human_id,
    created_at: finalTask.created_at,
    submission,
    paid_status: normalizePaymentStatus(finalTask.paid_status),
    approved_at: finalTask.approved_at ?? null,
    paid_at: finalTask.paid_at ?? null,
    paid_method: finalTask.paid_method ?? null,
    fee_rate: finalTask.fee_rate ?? null,
    fee_amount: finalTask.fee_amount ?? null,
    payout_amount: finalTask.payout_amount ?? null,
    paypal_fee_amount: finalTask.paypal_fee_amount ?? null,
    payout_batch_id: finalTask.payout_batch_id ?? null,
    payment_error_message: finalTask.payment_error_message ?? null
  };
}
