import type Database from "better-sqlite3";
import type { FailureReason, Task, Submission } from "@/lib/db";
import { normalizeLang, type UiLang } from "@/lib/i18n";

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
  deliverable: "photo" | "video" | "text";
  deadline_at: string | null;
  status: "open" | "accepted" | "completed" | "failed";
  failure_reason: FailureReason | null;
  human_id: string | null;
  created_at: string;
  submission: NormalizedSubmission;
};

// Task lifecycle:
// open -> accepted -> completed
// open -> failed
// accepted -> failed
const FAILURE_REASONS = new Set<FailureReason>([
  "no_human_available",
  "timeout",
  "invalid_request",
  "wrong_deliverable",
  "already_assigned",
  "not_assigned",
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
  db: Database,
  task: Task
): Promise<NormalizedSubmission> {
  if (task.submission_id) {
    const submission = db
      .prepare(`SELECT * FROM submissions WHERE id = ?`)
      .get(task.submission_id);
    return submission || null;
  }

  const submission = db
    .prepare(
      `SELECT * FROM submissions WHERE task_id = ? ORDER BY created_at DESC LIMIT 1`
    )
    .get(task.id);
  return submission || null;
}

function applyTimeoutIfNeeded(
  db: Database,
  task: Task,
  deadlineAt: string | null
) {
  if (!deadlineAt) return task;
  if (task.status === "completed" || task.status === "failed") return task;

  const deadlineMs = Date.parse(deadlineAt);
  if (!Number.isFinite(deadlineMs)) return task;
  if (Date.now() <= deadlineMs) return task;

  db.prepare(
    `UPDATE tasks SET status = 'failed', failure_reason = 'timeout', deadline_at = ? WHERE id = ?`
  ).run(deadlineAt, task.id);
  if (task.human_id) {
    db.prepare(`UPDATE humans SET status = 'available' WHERE id = ?`).run(
      task.human_id
    );
  }

  return {
    ...task,
    status: "failed",
    failure_reason: "timeout",
    deadline_at: deadlineAt
  };
}

function ensureTaskEnglish(db: Database, task: Task): string {
  const taskEn = task.task_en || task.task;
  if (!task.task_en) {
    db.prepare(`UPDATE tasks SET task_en = ? WHERE id = ?`).run(taskEn, task.id);
  }
  return taskEn;
}

export function getTaskDisplay(
  db: Database,
  task: Task,
  langValue: string | null
): { display: string; lang: UiLang } {
  const lang = normalizeLang(langValue);
  const taskEn = ensureTaskEnglish(db, task);
  if (lang === "en") {
    return { display: taskEn, lang };
  }

  const existing = db
    .prepare(
      `SELECT text FROM task_translations WHERE task_id = ? AND lang = ?`
    )
    .get(task.id, lang) as { text: string } | undefined;

  if (existing?.text) {
    return { display: existing.text, lang };
  }

  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO task_translations (task_id, lang, text, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(task.id, lang, taskEn, now, now);

  return { display: taskEn, lang };
}

export async function getNormalizedTask(
  db: Database,
  taskId: string,
  langValue: string | null
): Promise<NormalizedTask | null> {
  const rawTask = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(taskId);
  if (!rawTask) return null;

  const task = rawTask as Task;
  const deadlineAt = computeDeadlineAt(task);
  const finalTask = applyTimeoutIfNeeded(db, task, deadlineAt);
  const submission = await fetchSubmission(db, finalTask);
  const normalizedDeliverable = finalTask.deliverable || "text";
  const { display: taskDisplay, lang } = getTaskDisplay(
    db,
    finalTask,
    langValue
  );

  if (!finalTask.deliverable) {
    db.prepare(`UPDATE tasks SET deliverable = 'text' WHERE id = ?`).run(
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
    deliverable: normalizedDeliverable,
    deadline_at: deadlineAt,
    status: finalTask.status,
    failure_reason: failureReason,
    human_id: finalTask.human_id,
    created_at: finalTask.created_at,
    submission
  };
}
