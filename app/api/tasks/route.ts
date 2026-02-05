import crypto from "crypto";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET(request: Request) {
  const db = getDb();
  const url = new URL(request.url);
  const taskId = url.searchParams.get("task_id");
  const humanId = url.searchParams.get("human_id");

  if (taskId) {
    const task = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(taskId);
    if (!task) {
      return NextResponse.json({ status: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ task });
  }

  if (humanId) {
    const human = db.prepare(`SELECT * FROM humans WHERE id = ?`).get(humanId);
    if (!human) {
      return NextResponse.json({ status: "not_found" }, { status: 404 });
    }

    const openTasks = db
      .prepare(
        `SELECT * FROM tasks
         WHERE status = 'open'
           AND budget_usd >= ?
           AND (location IS NULL OR location = ?)
         ORDER BY created_at DESC`
      )
      .all(human.min_budget_usd, human.location);

    const assignedTasks = db
      .prepare(
        `SELECT * FROM tasks
         WHERE human_id = ?
           AND status IN ('accepted', 'completed')
         ORDER BY created_at DESC`
      )
      .all(humanId);

    const byId = new Map<string, any>();
    for (const task of [...assignedTasks, ...openTasks]) {
      byId.set(task.id, task);
    }

    return NextResponse.json({ tasks: Array.from(byId.values()) });
  }

  const tasks = db.prepare(`SELECT * FROM tasks ORDER BY created_at DESC`).all();
  return NextResponse.json({ tasks });
}

export async function POST(request: Request) {
  const payload = await request.json();
  const task = typeof payload?.task === "string" ? payload.task.trim() : "";
  const budgetUsd = Number(payload?.budget_usd);

  if (!task || !Number.isFinite(budgetUsd)) {
    return NextResponse.json({ status: "error" }, { status: 400 });
  }

  const db = getDb();
  const id = payload?.id ?? crypto.randomUUID();
  const createdAt = new Date().toISOString();

  const rawLocation = typeof payload?.location === \"string\" ? payload.location.trim() : \"\";
  const location = rawLocation.length > 0 ? rawLocation : null;

  db.prepare(
    `INSERT INTO tasks (id, task, location, budget_usd, deliverable, deadline_minutes, status, human_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'open', NULL, ?)`
  ).run(
    id,
    task,
    location,
    budgetUsd,
    payload?.deliverable ?? null,
    payload?.deadline_minutes ?? null,
    createdAt
  );

  return NextResponse.json({ id, status: "open" });
}
