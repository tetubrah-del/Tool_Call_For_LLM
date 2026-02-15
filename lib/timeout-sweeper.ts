import type { DbClient } from "@/lib/db";
import { dispatchTaskEvent } from "@/lib/webhooks";
import { closeContactChannel } from "@/lib/contact-channel";
import { computeReviewPendingDeadline } from "@/lib/review-pending";
import { computeReviewDeadlineAt } from "@/lib/task-reviews";

type TaskRow = {
  id: string;
  deadline_at: string | null;
  deadline_minutes: number | null;
  review_pending_deadline_at: string | null;
  created_at: string;
  status: "open" | "accepted" | "review_pending" | "completed" | "failed";
  human_id: string | null;
  submission_id: string | null;
};

const SWEEP_INTERVAL_MS = 60 * 1000;
const SWEEPER_KEY = "__timeout_sweeper_started__";

function computeDeadlineAt(task: TaskRow): string | null {
  if (task.deadline_at) return task.deadline_at;
  if (task.deadline_minutes == null) return null;
  if (!Number.isFinite(task.deadline_minutes)) return null;
  const createdAt = Date.parse(task.created_at);
  if (!Number.isFinite(createdAt)) return null;
  const deadlineMs = createdAt + task.deadline_minutes * 60 * 1000;
  return new Date(deadlineMs).toISOString();
}

async function sweepTimeouts(db: DbClient) {
  const now = Date.now();
  const candidates = await db
    .prepare(
      `SELECT id, deadline_at, deadline_minutes, review_pending_deadline_at, created_at, status, human_id, submission_id
       FROM tasks
       WHERE (
         status IN ('open', 'accepted')
         AND (deadline_at IS NOT NULL OR deadline_minutes IS NOT NULL)
       )
       OR status = 'review_pending'`
    )
    .all<TaskRow>();

  for (const task of candidates) {
    if (task.status === "review_pending") {
      let reviewDeadlineAt = task.review_pending_deadline_at;
      if (!reviewDeadlineAt) {
        let baseIso = nowIso();
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
      const completedAt = nowIso();
      const updated = await db
        .prepare(
          `UPDATE tasks
           SET status = 'completed',
               review_pending_deadline_at = NULL,
               completed_at = ?,
               review_deadline_at = ?
           WHERE id = ? AND status = 'review_pending'`
        )
        .run(completedAt, computeReviewDeadlineAt(completedAt), task.id);
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

    if (task.human_id) {
      await db.prepare(`UPDATE humans SET status = 'available' WHERE id = ?`).run(
        task.human_id
      );
    }
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
    void sweepTimeouts(db);
  }, SWEEP_INTERVAL_MS).unref?.();
}
