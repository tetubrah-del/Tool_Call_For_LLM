import crypto from "crypto";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getNormalizedTask, getTaskDisplay } from "@/lib/task-api";
import { MIN_BUDGET_USD, OPERATOR_COUNTRY } from "@/lib/payments";
import { normalizeCountry } from "@/lib/country";
import { normalizeTaskLabel } from "@/lib/task-labels";

export async function GET(request: Request) {
  const db = getDb();
  const url = new URL(request.url);
  const taskId = url.searchParams.get("task_id");
  const humanId = url.searchParams.get("human_id");
  const lang = url.searchParams.get("lang");
  const keyword = (url.searchParams.get("q") || "").trim().toLowerCase();
  const filterTaskLabel = normalizeTaskLabel(url.searchParams.get("task_label"));

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
    if (!human.paypal_email) {
      return NextResponse.json(
        { status: "error", reason: "invalid_request" },
        { status: 400 }
      );
    }

    const restrictToDomestic = human.country !== OPERATOR_COUNTRY;
    const openWhere: string[] = [
      "status = 'open'",
      "budget_usd >= ?",
      "(location IS NULL OR location = ?)"
    ];
    const openParams: Array<string | number | null> = [human.min_budget_usd, human.location];
    if (restrictToDomestic) {
      openWhere.push("origin_country = ?");
      openParams.push(OPERATOR_COUNTRY);
    }
    if (filterTaskLabel) {
      openWhere.push("task_label = ?");
      openParams.push(filterTaskLabel);
    }
    const openTasks = db
      .prepare(
        `SELECT * FROM tasks
         WHERE ${openWhere.join(" AND ")}
         ORDER BY created_at DESC`
      )
      .all(...openParams);

    const assignedWhere: string[] = ["human_id = ?", "status IN ('accepted', 'completed')"];
    const assignedParams: Array<string | number | null> = [humanId];
    if (filterTaskLabel) {
      assignedWhere.push("task_label = ?");
      assignedParams.push(filterTaskLabel);
    }
    const assignedTasks = db
      .prepare(
        `SELECT * FROM tasks
         WHERE ${assignedWhere.join(" AND ")}
         ORDER BY created_at DESC`
      )
      .all(...assignedParams);

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
      const normalizedTaskLabel = normalizeTaskLabel(task.task_label);
      return {
        ...task,
        task_label: normalizedTaskLabel,
        deliverable: task.deliverable || "text",
        task_display: display.display,
        lang: display.lang,
        is_international_payout: human.country !== OPERATOR_COUNTRY
      };
    });

    const filteredByKeyword =
      keyword.length === 0
        ? tasks
        : tasks.filter((task: any) => {
            const source = `${task.task_display || task.task || ""}`.toLowerCase();
            return source.includes(keyword);
          });

    return NextResponse.json({ tasks: filteredByKeyword });
  }

  const where: string[] = [];
  const params: Array<string | number | null> = [];
  if (filterTaskLabel) {
    where.push("task_label = ?");
    params.push(filterTaskLabel);
  }
  const tasks = db
    .prepare(
      `SELECT * FROM tasks ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC`
    )
    .all(...params);
  const normalized = tasks.map((task: any) => {
    const display = getTaskDisplay(db, task, lang);
    if (!task.deliverable) {
      db.prepare(`UPDATE tasks SET deliverable = 'text' WHERE id = ?`).run(
        task.id
      );
    }
    const normalizedTaskLabel = normalizeTaskLabel(task.task_label);
    return {
      ...task,
      task_label: normalizedTaskLabel,
      deliverable: task.deliverable || "text",
      task_display: display.display,
      lang: display.lang,
      paid_status: task.paid_status ?? "unpaid"
    };
  });
  const filteredByKeyword =
    keyword.length === 0
      ? normalized
      : normalized.filter((task: any) => {
          const source = `${task.task_display || task.task || ""}`.toLowerCase();
          return source.includes(keyword);
        });
  return NextResponse.json({ tasks: filteredByKeyword });
}

export async function POST(request: Request) {
  const payload = await request.json();
  const task = typeof payload?.task === "string" ? payload.task.trim() : "";
  const budgetUsd = Number(payload?.budget_usd);
  const originCountry = normalizeCountry(payload?.origin_country);
  const taskLabel = normalizeTaskLabel(payload?.task_label);
  const aiAccountId =
    typeof payload?.ai_account_id === "string" ? payload.ai_account_id.trim() : "";
  const aiApiKey =
    typeof payload?.ai_api_key === "string" ? payload.ai_api_key.trim() : "";
  const acceptanceCriteria =
    typeof payload?.acceptance_criteria === "string"
      ? payload.acceptance_criteria.trim()
      : "";
  const notAllowed =
    typeof payload?.not_allowed === "string" ? payload.not_allowed.trim() : "";

  if (!task || !Number.isFinite(budgetUsd)) {
    return NextResponse.json({ status: "error" }, { status: 400 });
  }
  if (!originCountry) {
    return NextResponse.json(
      { status: "error", reason: "missing_origin_country" },
      { status: 400 }
    );
  }
  if (!taskLabel) {
    return NextResponse.json(
      { status: "error", reason: "invalid_request" },
      { status: 400 }
    );
  }
  if (!acceptanceCriteria || !notAllowed) {
    return NextResponse.json(
      { status: "error", reason: "invalid_request" },
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
  let payerPaypalEmail: string | null = null;
  if (aiAccountId || aiApiKey) {
    if (!aiAccountId || !aiApiKey) {
      return NextResponse.json(
        { status: "error", reason: "invalid_request" },
        { status: 400 }
      );
    }
    const aiAccount = db
      .prepare(`SELECT * FROM ai_accounts WHERE id = ?`)
      .get(aiAccountId) as
      | { id: string; paypal_email: string; api_key: string; status: string }
      | undefined;
    if (!aiAccount || aiAccount.api_key !== aiApiKey || aiAccount.status !== "active") {
      return NextResponse.json(
        { status: "error", reason: "invalid_request" },
        { status: 400 }
      );
    }
    payerPaypalEmail = aiAccount.paypal_email;
  }

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
    `INSERT INTO tasks (id, task, task_en, location, budget_usd, origin_country, task_label, acceptance_criteria, not_allowed, ai_account_id, payer_paypal_email, payee_paypal_email, deliverable, deadline_minutes, deadline_at, status, failure_reason, human_id, submission_id, paid_status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, 'open', NULL, NULL, NULL, 'unpaid', ?)`
  ).run(
    id,
    task,
    task,
    location,
    budgetUsd,
    originCountry,
    taskLabel,
    acceptanceCriteria,
    notAllowed,
    aiAccountId || null,
    payerPaypalEmail,
    payload?.deliverable ?? "text",
    deadlineMinutes,
    deadlineAt,
    createdAt
  );

  return NextResponse.json({ id, status: "open" });
}
