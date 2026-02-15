import crypto from "crypto";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getNormalizedTask, getTaskDisplay } from "@/lib/task-api";
import { MIN_BUDGET_USD, OPERATOR_COUNTRY, normalizePaymentStatus } from "@/lib/payments";
import { normalizeCountry } from "@/lib/country";
import { normalizeTaskLabel } from "@/lib/task-labels";
import { finishIdempotency, startIdempotency } from "@/lib/idempotency";
import { applyAiRateLimitHeaders, authenticateAiApiRequest, type AiAuthSuccess } from "@/lib/ai-api-auth";
import { getRequestCountry } from "@/lib/request-country";
import {
  chooseDisplayCurrency,
  fromUsdForDisplay,
  minorToUsd,
  minorToDisplayAmount,
  normalizeCurrencyCode,
  usdToMinor
} from "@/lib/currency-display";

export async function GET(request: Request) {
  const db = getDb();
  const url = new URL(request.url);
  const requestCountry = getRequestCountry(request);
  const taskId = url.searchParams.get("task_id");
  const humanId = url.searchParams.get("human_id");
  const lang = url.searchParams.get("lang");
  const keyword = (url.searchParams.get("q") || "").trim().toLowerCase();
  const filterTaskLabel = normalizeTaskLabel(url.searchParams.get("task_label"));
  const withDisplayAmount = (task: any) => {
    const quoteCurrency = normalizeCurrencyCode(task?.quote_currency);
    const quoteAmountMinor = Number(task?.quote_amount_minor);
    if (quoteCurrency && Number.isInteger(quoteAmountMinor) && quoteAmountMinor >= 0) {
      return {
        ...task,
        display_currency: quoteCurrency,
        display_amount: minorToDisplayAmount(quoteAmountMinor, quoteCurrency)
      };
    }
    const displayCurrency = chooseDisplayCurrency(task?.origin_country || null, requestCountry);
    return {
      ...task,
      display_currency: displayCurrency.toLowerCase(),
      display_amount: fromUsdForDisplay(Number(task?.budget_usd || 0), displayCurrency)
    };
  };

  if (taskId) {
    const task = await getNormalizedTask(db, taskId, lang);
    if (!task) {
      return NextResponse.json({ status: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ task: withDisplayAmount(task), request_country: requestCountry });
  }

  if (humanId) {
    const human = await db
      .prepare(`SELECT * FROM humans WHERE id = ? AND deleted_at IS NULL`)
      .get(humanId);
    if (!human) {
      return NextResponse.json({ status: "not_found" }, { status: 404 });
    }
    if (!human.country) {
      return NextResponse.json(
        { status: "error", reason: "missing_country" },
        { status: 400 }
      );
    }

    const openWhere: string[] = [
      "deleted_at IS NULL",
      "status = 'open'"
    ];
    const openParams: Array<string | number | null> = [];
    if (filterTaskLabel) {
      openWhere.push("task_label = ?");
      openParams.push(filterTaskLabel);
    }
    const openTasks = await db
      .prepare(
        `SELECT * FROM tasks
         WHERE ${openWhere.join(" AND ")}
         ORDER BY created_at DESC`
      )
      .all(...openParams);

    const assignedWhere: string[] = [
      "deleted_at IS NULL",
      "human_id = ?",
      "status IN ('accepted', 'review_pending', 'completed')"
    ];
    const assignedParams: Array<string | number | null> = [humanId];
    if (filterTaskLabel) {
      assignedWhere.push("task_label = ?");
      assignedParams.push(filterTaskLabel);
    }
    const assignedTasks = await db
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

    const tasks = [];
    for (const task of Array.from(byId.values())) {
      const display = await getTaskDisplay(db, task, lang);
      if (!task.deliverable) {
        await db
          .prepare(`UPDATE tasks SET deliverable = 'text' WHERE id = ?`)
          .run(task.id);
      }
      const normalizedTaskLabel = normalizeTaskLabel(task.task_label);
      tasks.push(withDisplayAmount({
        ...task,
        task_label: normalizedTaskLabel,
        deliverable: task.deliverable || "text",
        task_display: display.display,
        lang: display.lang,
        paid_status: normalizePaymentStatus(task.paid_status),
        is_international_payout: human.country !== OPERATOR_COUNTRY
      }));
    }

    const filteredByKeyword =
      keyword.length === 0
        ? tasks
        : tasks.filter((task: any) => {
            const source = `${task.task_display || task.task || ""}`.toLowerCase();
            return source.includes(keyword);
          });

    return NextResponse.json({ tasks: filteredByKeyword, request_country: requestCountry });
  }

  const where: string[] = [];
  const params: Array<string | number | null> = [];
  where.push("deleted_at IS NULL");
  if (filterTaskLabel) {
    where.push("task_label = ?");
    params.push(filterTaskLabel);
  }
  const tasks = await db
    .prepare(
      `SELECT * FROM tasks ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC`
    )
    .all(...params);
  const normalized = [];
  for (const task of tasks) {
    const display = await getTaskDisplay(db, task, lang);
    if (!task.deliverable) {
      await db
        .prepare(`UPDATE tasks SET deliverable = 'text' WHERE id = ?`)
        .run(task.id);
    }
    const normalizedTaskLabel = normalizeTaskLabel(task.task_label);
      normalized.push(withDisplayAmount({
        ...task,
        task_label: normalizedTaskLabel,
        deliverable: task.deliverable || "text",
        task_display: display.display,
        lang: display.lang,
        paid_status: normalizePaymentStatus(task.paid_status)
      }));
  }
  const filteredByKeyword =
    keyword.length === 0
      ? normalized
      : normalized.filter((task: any) => {
          const source = `${task.task_display || task.task || ""}`.toLowerCase();
          return source.includes(keyword);
        });
  return NextResponse.json({ tasks: filteredByKeyword, request_country: requestCountry });
}

export async function POST(request: Request) {
  const idemKey = request.headers.get("Idempotency-Key")?.trim() || null;
  const payload = await request.json();
  const task = typeof payload?.task === "string" ? payload.task.trim() : "";
  const budgetUsdRaw = Number(payload?.budget_usd);
  const currencyInput = normalizeCurrencyCode(payload?.currency);
  const amountMinorInput = payload?.amount_minor;
  const amountMinor =
    amountMinorInput == null || amountMinorInput === "" ? null : Number(amountMinorInput);
  const originCountry = normalizeCountry(payload?.origin_country);
  const quoteCurrency = currencyInput || (originCountry === "JP" ? "jpy" : "usd");
  const budgetUsd =
    amountMinor != null && Number.isInteger(amountMinor) && amountMinor >= 0
      ? minorToUsd(amountMinor, quoteCurrency)
      : budgetUsdRaw;
  const quoteAmountMinor =
    amountMinor != null && Number.isInteger(amountMinor) && amountMinor >= 0
      ? amountMinor
      : usdToMinor(budgetUsd, quoteCurrency);
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

  const db = getDb();
  let aiAuth: AiAuthSuccess | null = null;
  const idemStart = await startIdempotency(db, {
    route: "/api/tasks",
    idemKey,
    aiAccountId: aiAccountId || null,
    payload
  });
  if (idemStart.replay) {
    return NextResponse.json(idemStart.body, {
      status: idemStart.statusCode,
      headers: idemKey ? { "Idempotency-Replayed": "true" } : undefined
    });
  }
  if (!idemStart.replay && idemStart.blocked) {
    return NextResponse.json(idemStart.body, { status: idemStart.statusCode });
  }

  async function respond(body: any, status = 200, headers?: HeadersInit) {
    await finishIdempotency(db, {
      route: "/api/tasks",
      idemKey,
      aiAccountId: aiAccountId || null,
      statusCode: status,
      responseBody: body
    });
    let response = NextResponse.json(body, { status, headers });
    if (aiAuth) {
      response = applyAiRateLimitHeaders(response, aiAuth);
    }
    return response;
  }

  if (!task || !Number.isFinite(budgetUsd)) {
    return respond({ status: "error" }, 400);
  }
  if (amountMinor != null && (!Number.isInteger(amountMinor) || amountMinor < 0)) {
    return respond({ status: "error", reason: "invalid_request" }, 400);
  }
  if (!originCountry) {
    return respond({ status: "error", reason: "missing_origin_country" }, 400);
  }
  if (!taskLabel) {
    return respond({ status: "error", reason: "invalid_request" }, 400);
  }
  if (!acceptanceCriteria || !notAllowed) {
    return respond({ status: "error", reason: "invalid_request" }, 400);
  }
  if (budgetUsd < MIN_BUDGET_USD) {
    return respond({ status: "error", reason: "below_min_budget" }, 400);
  }

  let payerPaypalEmail: string | null = null;
  if (aiAccountId || aiApiKey) {
    if (!aiAccountId || !aiApiKey) {
      return respond({ status: "error", reason: "invalid_request" }, 400);
    }
    const auth = await authenticateAiApiRequest(aiAccountId, aiApiKey);
    if (auth.ok === false) {
      if (auth.response.status === 429) {
        return respond(
          { status: "error", reason: "rate_limited" },
          429,
          Object.fromEntries(auth.response.headers.entries())
        );
      }
      return respond({ status: "error", reason: "invalid_request" }, 400);
    }
    aiAuth = auth;
    const aiAccount = await db
      .prepare(`SELECT paypal_email FROM ai_accounts WHERE id = ?`)
      .get<{ paypal_email: string | null }>(aiAccountId);
    payerPaypalEmail = aiAccount?.paypal_email || null;
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

  await db.prepare(
    `INSERT INTO tasks (id, task, task_en, location, budget_usd, quote_currency, quote_amount_minor, origin_country, task_label, acceptance_criteria, not_allowed, ai_account_id, payer_paypal_email, payee_paypal_email, deliverable, deadline_minutes, deadline_at, status, failure_reason, human_id, submission_id, paid_status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, 'open', NULL, NULL, NULL, 'pending', ?)`
  ).run(
    id,
    task,
    task,
    location,
    budgetUsd,
    quoteCurrency,
    quoteAmountMinor,
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

  return respond({ id, status: "open" });
}
