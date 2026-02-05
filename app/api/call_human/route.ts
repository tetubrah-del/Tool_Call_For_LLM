import crypto from "crypto";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function POST(request: Request) {
  let payload: any = null;
  try {
    payload = await request.json();
  } catch {
    payload = null;
  }

  const task = typeof payload?.task === "string" ? payload.task.trim() : "";
  const budgetUsd = Number(payload?.budget_usd);
  const rawLocation =
    typeof payload?.location === "string" ? payload.location.trim() : "";
  const location = rawLocation.length > 0 ? rawLocation : null;
  const deliverable =
    payload?.deliverable === "photo" ||
    payload?.deliverable === "video" ||
    payload?.deliverable === "text"
      ? payload.deliverable
      : null;
  const deadlineMinutes = payload?.deadline_minutes != null ? Number(payload.deadline_minutes) : null;

  if (!task || !Number.isFinite(budgetUsd)) {
    return NextResponse.json(
      { status: "rejected", reason: "invalid_request" },
      { status: 400 }
    );
  }

  const db = getDb();
  const taskId = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  db.prepare(
    `INSERT INTO tasks (id, task, location, budget_usd, deliverable, deadline_minutes, status, human_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'open', NULL, ?)`
  ).run(taskId, task, location, budgetUsd, deliverable, deadlineMinutes, createdAt);

  const stmt = db.prepare(
    `SELECT * FROM humans
     WHERE status = 'available'
       AND min_budget_usd <= ?
       ${location ? "AND location = ?" : ""}
     ORDER BY min_budget_usd ASC
     LIMIT 1`
  );
  const params = location ? [budgetUsd, location] : [budgetUsd];
  const human = stmt.get(...params);

  if (!human) {
    db.prepare(`UPDATE tasks SET status = 'failed' WHERE id = ?`).run(taskId);
    return NextResponse.json({ status: "rejected", reason: "no_human_available" });
  }

  db.prepare(`UPDATE tasks SET status = 'accepted', human_id = ? WHERE id = ?`).run(
    human.id,
    taskId
  );
  db.prepare(`UPDATE humans SET status = 'busy' WHERE id = ?`).run(human.id);
  // Payment is mocked for MVP; integrate Stripe here later if needed.

  return NextResponse.json({
    task_id: taskId,
    status: "accepted",
    eta_minutes: 15
  });
}
