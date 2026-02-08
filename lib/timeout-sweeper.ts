import type Database from "better-sqlite3";
import { dispatchTaskEvent } from "@/lib/webhooks";

type TaskRow = {
  id: string;
  deadline_at: string | null;
  deadline_minutes: number | null;
  created_at: string;
  status: "open" | "accepted" | "completed" | "failed";
  human_id: string | null;
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

function sweepTimeouts(db: Database) {
  const now = Date.now();
  const candidates = db
    .prepare(
      `SELECT id, deadline_at, deadline_minutes, created_at, status, human_id
       FROM tasks
       WHERE status IN ('open', 'accepted')
         AND (deadline_at IS NOT NULL OR deadline_minutes IS NOT NULL)`
    )
    .all() as TaskRow[];

  for (const task of candidates) {
    const deadlineAt = computeDeadlineAt(task);
    if (!deadlineAt) continue;
    const deadlineMs = Date.parse(deadlineAt);
    if (!Number.isFinite(deadlineMs) || now <= deadlineMs) continue;

    db.prepare(
      `UPDATE tasks
       SET status = 'failed', failure_reason = 'timeout', deadline_at = ?
       WHERE id = ?`
    ).run(deadlineAt, task.id);

    if (task.human_id) {
      db.prepare(`UPDATE humans SET status = 'available' WHERE id = ?`).run(
        task.human_id
      );
    }
    void dispatchTaskEvent(db, { eventType: "task.failed", taskId: task.id }).catch(() => {});
  }
}

export function startTimeoutSweeper(db: Database) {
  const g = globalThis as typeof globalThis & { [SWEEPER_KEY]?: boolean };
  if (g[SWEEPER_KEY]) return;
  g[SWEEPER_KEY] = true;

  setInterval(() => sweepTimeouts(db), SWEEP_INTERVAL_MS).unref?.();
}
