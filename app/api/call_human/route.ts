import crypto from "crypto";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { MIN_BUDGET_USD } from "@/lib/payments";
import { normalizeCountry } from "@/lib/country";
import { normalizeTaskLabel } from "@/lib/task-labels";

export async function POST(request: Request) {
  let payload: any = null;
  try {
    payload = await request.json();
  } catch {
    payload = null;
  }

  const task = typeof payload?.task === "string" ? payload.task.trim() : "";
  const budgetUsd = Number(payload?.budget_usd);
  const aiAccountId =
    typeof payload?.ai_account_id === "string" ? payload.ai_account_id.trim() : "";
  const aiApiKey =
    typeof payload?.ai_api_key === "string" ? payload.ai_api_key.trim() : "";
  const rawLocation =
    typeof payload?.location === "string" ? payload.location.trim() : "";
  const location = rawLocation.length > 0 ? rawLocation : null;
  const originCountry = normalizeCountry(payload?.origin_country);
  const taskLabel = normalizeTaskLabel(payload?.task_label);
  const acceptanceCriteria =
    typeof payload?.acceptance_criteria === "string"
      ? payload.acceptance_criteria.trim()
      : "";
  const notAllowed =
    typeof payload?.not_allowed === "string" ? payload.not_allowed.trim() : "";
  const deliverable =
    payload?.deliverable === "photo" ||
    payload?.deliverable === "video" ||
    payload?.deliverable === "text"
      ? payload.deliverable
      : null;
  const normalizedDeliverable = deliverable || "text";
  const deadlineMinutes =
    payload?.deadline_minutes != null ? Number(payload.deadline_minutes) : null;
  const createdAt = new Date().toISOString();
  const deadlineAt =
    deadlineMinutes != null && Number.isFinite(deadlineMinutes)
      ? new Date(Date.parse(createdAt) + deadlineMinutes * 60 * 1000).toISOString()
      : null;

  if (!task || !Number.isFinite(budgetUsd) || !aiAccountId || !aiApiKey) {
    return NextResponse.json(
      { status: "rejected", reason: "invalid_request" },
      { status: 400 }
    );
  }
  if (!originCountry) {
    return NextResponse.json(
      { status: "rejected", reason: "missing_origin_country" },
      { status: 400 }
    );
  }
  if (!taskLabel) {
    return NextResponse.json(
      { status: "rejected", reason: "invalid_request" },
      { status: 400 }
    );
  }
  if (!acceptanceCriteria || !notAllowed) {
    return NextResponse.json(
      { status: "rejected", reason: "invalid_request" },
      { status: 400 }
    );
  }
  if (budgetUsd < MIN_BUDGET_USD) {
    return NextResponse.json(
      { status: "rejected", reason: "below_min_budget" },
      { status: 400 }
    );
  }

  const db = getDb();
  const aiAccount = db
    .prepare(`SELECT * FROM ai_accounts WHERE id = ?`)
    .get(aiAccountId) as
    | { id: string; paypal_email: string; api_key: string; status: string }
    | undefined;
  if (!aiAccount || aiAccount.api_key !== aiApiKey || aiAccount.status !== "active") {
    return NextResponse.json(
      { status: "rejected", reason: "invalid_request" },
      { status: 400 }
    );
  }

  const taskId = crypto.randomUUID();
  db.prepare(
    `INSERT INTO tasks (id, task, task_en, location, budget_usd, origin_country, task_label, acceptance_criteria, not_allowed, ai_account_id, payer_paypal_email, payee_paypal_email, deliverable, deadline_minutes, deadline_at, status, failure_reason, human_id, submission_id, paid_status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, 'open', NULL, NULL, NULL, 'unpaid', ?)`
  ).run(
    taskId,
    task,
    task,
    location,
    budgetUsd,
    originCountry,
    taskLabel,
    acceptanceCriteria,
    notAllowed,
    aiAccountId,
    aiAccount.paypal_email,
    normalizedDeliverable,
    deadlineMinutes,
    deadlineAt,
    createdAt
  );

  const stmt = db.prepare(
    `SELECT * FROM humans
     WHERE status = 'available'
       AND paypal_email IS NOT NULL
       AND paypal_email <> ''
       AND min_budget_usd <= ?
       ${location ? "AND location = ?" : ""}
     ORDER BY min_budget_usd ASC
     LIMIT 1`
  );
  const params = location ? [budgetUsd, location] : [budgetUsd];
  const human = stmt.get(...params);

  if (!human) {
    db.prepare(
      `UPDATE tasks SET status = 'failed', failure_reason = 'no_human_available' WHERE id = ?`
    ).run(taskId);
    return NextResponse.json({ status: "rejected", reason: "no_human_available" });
  }

  db.prepare(`UPDATE tasks SET status = 'accepted', human_id = ? WHERE id = ?`).run(
    human.id,
    taskId
  );
  db.prepare(`UPDATE tasks SET payee_paypal_email = ? WHERE id = ?`).run(
    human.paypal_email,
    taskId
  );
  db.prepare(`UPDATE humans SET status = 'busy' WHERE id = ?`).run(human.id);
  // Payment is mocked for MVP; integrate Stripe here later if needed.

  return NextResponse.json({
    task_id: taskId,
    status: "accepted"
  });
}
