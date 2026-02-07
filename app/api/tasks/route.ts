import crypto from "crypto";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getNormalizedTask, getTaskDisplay } from "@/lib/task-api";
import { MIN_BUDGET_USD, OPERATOR_COUNTRY } from "@/lib/payments";
import { normalizeCountry } from "@/lib/country";

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
    if (!human.country) {
      return NextResponse.json(
        { status: "error", reason: "missing_country" },
        { status: 400 }
      );
    }

    const restrictToDomestic = human.country !== OPERATOR_COUNTRY;
    const openTasks = db
      .prepare(
        `SELECT * FROM tasks
         WHERE status = 'open'
           AND budget_usd >= ?
           AND (location IS NULL OR location = ?)
           ${restrictToDomestic ? "AND origin_country = ?" : ""}
         ORDER BY created_at DESC`
      )
      .all(
        ...(restrictToDomestic
          ? [human.min_budget_usd, human.location, OPERATOR_COUNTRY]
          : [human.min_budget_usd, human.location])
      );

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
        lang: display.lang,
        is_international_payout: human.country !== OPERATOR_COUNTRY
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
  const originCountry = normalizeCountry(payload?.origin_country);

  if (!task || !Number.isFinite(budgetUsd)) {
    return NextResponse.json({ status: "error" }, { status: 400 });
  }
  if (!originCountry) {
    return NextResponse.json(
      { status: "error", reason: "missing_origin_country" },
      { status: 400 }
    );
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
    `INSERT INTO tasks (id, task, task_en, location, budget_usd, origin_country, deliverable, deadline_minutes, deadline_at, status, failure_reason, human_id, submission_id, paid_status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', NULL, NULL, NULL, 'unpaid', ?)`
  ).run(
    id,
    task,
    task,
    location,
    budgetUsd,
    originCountry,
    payload?.deliverable ?? "text",
    deadlineMinutes,
    deadlineAt,
    createdAt
  );

  return NextResponse.json({ id, status: "open" });
}
