import crypto from "crypto";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getCurrentHumanIdByEmail } from "@/lib/human-session";

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function verifyTestHumanToken(humanId: string, token: string): boolean {
  if (!humanId || !token) return false;
  if (process.env.NODE_ENV === "production") return false;
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

async function resolveAuthedHumanId(
  db: ReturnType<typeof getDb>,
  humanId: string,
  humanTestToken: string
): Promise<string | null> {
  // Auth: session (recommended) OR test-only token (dev).
  if (humanTestToken) {
    if (verifyTestHumanToken(humanId, humanTestToken)) return humanId;
    return null;
  }

  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return null;
  const sessionHumanId = await getCurrentHumanIdByEmail(email);
  return sessionHumanId || null;
}

export async function GET(
  request: Request,
  { params }: { params: { taskId: string } }
) {
  const url = new URL(request.url);
  const humanId = normalizeText(url.searchParams.get("human_id"));
  const humanTestToken = normalizeText(request.headers.get("x-human-test-token"));

  if (!humanId) {
    return NextResponse.json({ status: "error", reason: "missing_human" }, { status: 400 });
  }

  const db = getDb();
  const authedHumanId = await resolveAuthedHumanId(db, humanId, humanTestToken);
  if (!authedHumanId || authedHumanId !== humanId) {
    return NextResponse.json({ status: "unauthorized" }, { status: 401 });
  }

  const existing = await db
    .prepare(`SELECT id FROM task_applications WHERE task_id = ? AND human_id = ?`)
    .get<{ id: string }>(params.taskId, humanId);

  if (existing?.id) {
    return NextResponse.json({
      status: "applied",
      task_id: params.taskId,
      application_id: existing.id
    });
  }

  return NextResponse.json({ status: "not_applied", task_id: params.taskId });
}

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
  const authedHumanId = await resolveAuthedHumanId(db, humanId, humanTestToken);
  if (!authedHumanId || authedHumanId !== humanId) {
    return NextResponse.json({ status: "unauthorized" }, { status: 401 });
  }

  const task = await db
    .prepare(`SELECT id, status, human_id FROM tasks WHERE id = ? AND deleted_at IS NULL`)
    .get<{ id: string; status: string; human_id: string | null }>(params.taskId);
  if (!task?.id) {
    return NextResponse.json({ status: "not_found" }, { status: 404 });
  }
  if (task.status !== "open") {
    return NextResponse.json({ status: "error", reason: "not_open" }, { status: 409 });
  }
  if (task.human_id && task.human_id !== humanId) {
    return NextResponse.json({ status: "error", reason: "already_assigned" }, { status: 409 });
  }

  const human = await db
    .prepare(`SELECT id, paypal_email FROM humans WHERE id = ? AND deleted_at IS NULL`)
    .get<{ id: string; paypal_email: string | null }>(humanId);
  if (!human?.id) {
    return NextResponse.json({ status: "not_found" }, { status: 404 });
  }

  const existing = await db
    .prepare(`SELECT id FROM task_applications WHERE task_id = ? AND human_id = ?`)
    .get<{ id: string }>(params.taskId, humanId);
  if (existing?.id) {
    return NextResponse.json(
      { status: "error", reason: "already_applied", application_id: existing.id },
      { status: 409 }
    );
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

  return NextResponse.json({
    status: "applied",
    task_id: params.taskId,
    application_id: applicationId
  });
}
