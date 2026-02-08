import type Database from "better-sqlite3";

type TaskContactSeed = {
  id: string;
  ai_account_id: string | null;
  human_id: string | null;
};

export function ensurePendingContactChannel(
  db: Database,
  taskId: string
) {
  const task = db
    .prepare(`SELECT id, ai_account_id, human_id FROM tasks WHERE id = ?`)
    .get(taskId) as TaskContactSeed | undefined;
  if (!task?.id || !task.ai_account_id || !task.human_id) return;

  const now = new Date().toISOString();
  const existing = db
    .prepare(`SELECT task_id FROM task_contacts WHERE task_id = ?`)
    .get(taskId) as { task_id: string } | undefined;

  if (!existing?.task_id) {
    db.prepare(
      `INSERT INTO task_contacts (task_id, ai_account_id, human_id, status, created_at, opened_at, closed_at)
       VALUES (?, ?, ?, 'pending', ?, NULL, NULL)`
    ).run(taskId, task.ai_account_id, task.human_id, now);
    return;
  }

  db.prepare(
    `UPDATE task_contacts
     SET ai_account_id = ?, human_id = ?
     WHERE task_id = ?`
  ).run(task.ai_account_id, task.human_id, taskId);
}

export function openContactChannel(db: Database, taskId: string) {
  ensurePendingContactChannel(db, taskId);
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE task_contacts
     SET status = 'open', opened_at = COALESCE(opened_at, ?), closed_at = NULL
     WHERE task_id = ?`
  ).run(now, taskId);
}

export function closeContactChannel(db: Database, taskId: string) {
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE task_contacts
     SET status = 'closed', closed_at = COALESCE(closed_at, ?)
     WHERE task_id = ? AND status <> 'closed'`
  ).run(now, taskId);
}
