import type { DbClient } from "@/lib/db";

type TaskContactSeed = {
  id: string;
  ai_account_id: string | null;
  human_id: string | null;
};

export async function ensurePendingContactChannel(
  db: DbClient,
  taskId: string
) {
  const task = await db
    .prepare(`SELECT id, ai_account_id, human_id FROM tasks WHERE id = ?`)
    .get<TaskContactSeed>(taskId);
  if (!task?.id || !task.ai_account_id || !task.human_id) return;

  const now = new Date().toISOString();
  const existing = await db
    .prepare(`SELECT task_id FROM task_contacts WHERE task_id = ?`)
    .get<{ task_id: string }>(taskId);

  if (!existing?.task_id) {
    await db.prepare(
      `INSERT INTO task_contacts (task_id, ai_account_id, human_id, status, created_at, opened_at, closed_at)
       VALUES (?, ?, ?, 'pending', ?, NULL, NULL)`
    ).run(taskId, task.ai_account_id, task.human_id, now);
    return;
  }

  await db.prepare(
    `UPDATE task_contacts
     SET ai_account_id = ?, human_id = ?
     WHERE task_id = ?`
  ).run(task.ai_account_id, task.human_id, taskId);
}

export async function openContactChannel(db: DbClient, taskId: string) {
  await ensurePendingContactChannel(db, taskId);
  const now = new Date().toISOString();
  await db.prepare(
    `UPDATE task_contacts
     SET status = 'open', opened_at = COALESCE(opened_at, ?), closed_at = NULL
     WHERE task_id = ?`
  ).run(now, taskId);
}

export async function closeContactChannel(db: DbClient, taskId: string) {
  const now = new Date().toISOString();
  await db.prepare(
    `UPDATE task_contacts
     SET status = 'closed', closed_at = COALESCE(closed_at, ?)
     WHERE task_id = ? AND status <> 'closed'`
  ).run(now, taskId);
}
