import crypto from "crypto";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getNormalizedTask, getTaskDisplay } from "@/lib/task-api";
import { MIN_BUDGET_USD } from "@/lib/payments";

export async function GET(request: Request) {
  const db = getDb();
  const url = new URL(request.url);
  const taskId = url.searchParams.get("task_id");
  const humanId = url.searchParams.get("human_id");
  const lang = url.searchParams.get("lang");

  if (taskId) {
    const task = await getNormalizedTask(db, taskId, lang);
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

    const tasks = Array.from(byId.values()).map((task: any) => {
      const display = getTaskDisplay(db, task, lang);
      if (!task.deliverable) {
        db.prepare(`UPDATE tasks SET deliverable = 'text' WHERE id = ?`).run(
          task.id
        );
      }
      return {
        ...task,
        deliverable: task.deliverable || "text",
        task_display: display.display,
        lang: display.lang
      };
    });

    return NextResponse.json({ tasks });
  }

  const tasks = db.prepare(`SELECT * FROM tasks ORDER BY created_at DESC`).all();
  const normalized = tasks.map((task: any) => {
    const display = getTaskDisplay(db, task, lang);
    if (!task.deliverable) {
      db.prepare(`UPDATE tasks SET deliverable = 'text' WHERE id = ?`).run(
        task.id
      );
    }
    return {
      ...task,
      deliverable: task.deliverable || "text",
      task_display: display.display,
      lang: display.lang,
      paid_status: task.paid_status ?? "unpaid"
    };
  });
  return NextResponse.json({ tasks: normalized });
}

export async function POST(request: Request) {
  const payload = await request.json();
  const task = typeof payload?.task === "string" ? payload.task.trim() : "";
  const budgetUsd = Number(payload?.budget_usd);

  if (!task || !Number.isFinite(budgetUsd)) {
    return NextResponse.json({ status: "error" }, { status: 400 });
  }
  if (budgetUsd < MIN_BUDGET_USD) {
    return NextResponse.json(
      { status: "error", reason: "below_min_budget" },
      { status: 400 }
    );
  }

  const db = getDb();
  const id = payload?.id ?? crypto.randomUUID();
  const createdAt = new Date().toISOString();

  const rawLocation =
    typeof payload?.location === "string" ? payload.location.trim() : "";
  const location = rawLocation.length > 0 ? rawLocation : null;
  const deadlineMinutes =
    payload?.deadline_minutes != null ? Number(payload.deadline_minutes) : null;
  const deadlineAt =
    deadlineMinutes != null && Number.isFinite(deadlineMinutes)
      ? new Date(Date.parse(createdAt) + deadlineMinutes * 60 * 1000).toISOString()
      : null;

  db.prepare(
    `INSERT INTO tasks (id, task, task_en, location, budget_usd, deliverable, deadline_minutes, deadline_at, status, failure_reason, human_id, submission_id, paid_status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', NULL, NULL, NULL, 'unpaid', ?)`
  ).run(
    id,
    task,
    task,
    location,
    budgetUsd,
    payload?.deliverable ?? "text",
    deadlineMinutes,
    deadlineAt,
    createdAt
  );

  return NextResponse.json({ id, status: "open" });
}
