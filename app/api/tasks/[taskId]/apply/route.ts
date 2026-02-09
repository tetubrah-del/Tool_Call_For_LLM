import crypto from "crypto";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { dispatchTaskEvent } from "@/lib/webhooks";
import { ensurePendingContactChannel } from "@/lib/contact-channel";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getCurrentHumanIdByEmail } from "@/lib/human-session";

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function verifyTestHumanToken(humanId: string, token: string): boolean {
  if (!humanId || !token) return false;
  if (process.env.ENABLE_TEST_HUMAN_AUTH !== "true") return false;
  const secret = process.env.TEST_HUMAN_AUTH_SECRET || "";
  if (!secret) return false;
  const expected = crypto.createHmac("sha256", secret).update(humanId).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(token);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

const MAX_COVER_LETTER = 4000;
const MAX_AVAILABILITY = 500;

export async function POST(
  request: Request,
  { params }: { params: { taskId: string } }
) {
  const payload = await request.json().catch(() => null);
  const humanId = normalizeText(payload?.human_id);
  const humanTestToken = normalizeText(payload?.human_test_token);
  const coverLetter = normalizeText(payload?.cover_letter);
  const availability = normalizeText(payload?.availability);
  const counterBudgetUsdRaw = payload?.counter_budget_usd;
  const counterBudgetUsd =
    counterBudgetUsdRaw == null || counterBudgetUsdRaw === ""
      ? null
      : Number(counterBudgetUsdRaw);

  if (!humanId) {
    return NextResponse.json({ status: "error", reason: "missing_human" }, { status: 400 });
  }
  if (!coverLetter || !availability) {
    return NextResponse.json({ status: "error", reason: "invalid_request" }, { status: 400 });
  }
  if (coverLetter.length > MAX_COVER_LETTER || availability.length > MAX_AVAILABILITY) {
    return NextResponse.json({ status: "error", reason: "invalid_request" }, { status: 400 });
  }
  if (counterBudgetUsd != null && !Number.isFinite(counterBudgetUsd)) {
    return NextResponse.json({ status: "error", reason: "invalid_request" }, { status: 400 });
  }

  const db = getDb();

  // Auth: session (recommended) OR test-only token (dev).
  let authedHumanId: string | null = null;
  if (humanTestToken) {
    if (verifyTestHumanToken(humanId, humanTestToken)) authedHumanId = humanId;
  } else {
    const session = await getServerSession(authOptions);
    const email = session?.user?.email;
    if (email) {
      const sessionHumanId = await getCurrentHumanIdByEmail(email);
      if (sessionHumanId) authedHumanId = sessionHumanId;
    }
  }
  if (!authedHumanId || authedHumanId !== humanId) {
    return NextResponse.json({ status: "unauthorized" }, { status: 401 });
  }

  const task = await db
    .prepare(`SELECT id, status, human_id FROM tasks WHERE id = ?`)
    .get<{ id: string; status: string; human_id: string | null }>(params.taskId);
  if (!task?.id) {
    return NextResponse.json({ status: "not_found" }, { status: 404 });
  }
  if (task.status !== "open") {
    return NextResponse.json({ status: "error", reason: "not_assigned" }, { status: 409 });
  }
  if (task.human_id && task.human_id !== humanId) {
    return NextResponse.json({ status: "error", reason: "already_assigned" }, { status: 409 });
  }

  const human = await db
    .prepare(`SELECT id, paypal_email FROM humans WHERE id = ?`)
    .get<{ id: string; paypal_email: string | null }>(humanId);
  if (!human?.id) {
    return NextResponse.json({ status: "not_found" }, { status: 404 });
  }
  if (!human.paypal_email) {
    return NextResponse.json({ status: "error", reason: "invalid_request" }, { status: 400 });
  }

  const applicationId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO task_applications (id, task_id, human_id, cover_letter, availability, counter_budget_usd, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      applicationId,
      params.taskId,
      humanId,
      coverLetter,
      availability,
      counterBudgetUsd,
      createdAt
    );

  // MVP: applying immediately accepts the task.
  await db
    .prepare(`UPDATE tasks SET status = 'accepted', human_id = ?, payee_paypal_email = ? WHERE id = ?`)
    .run(humanId, human.paypal_email, params.taskId);
  await db.prepare(`UPDATE humans SET status = 'busy' WHERE id = ?`).run(humanId);
  await ensurePendingContactChannel(db, params.taskId);
  void dispatchTaskEvent(db, { eventType: "task.accepted", taskId: params.taskId }).catch(
    () => {}
  );

  return NextResponse.json({
    status: "accepted",
    task_id: params.taskId,
    application_id: applicationId
  });
}

