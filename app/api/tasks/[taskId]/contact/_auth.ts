import type { DbClient } from "@/lib/db";
import crypto from "crypto";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { authenticateAiApiRequest } from "@/lib/ai-api-auth";
import { parseAiAccountIdFromRequest, parseAiApiKeyFromRequest } from "@/lib/ai-api-auth";
import { getCurrentHumanIdByEmail } from "@/lib/human-session";

export type TaskForContact = {
  id: string;
  ai_account_id: string | null;
  human_id: string | null;
  status: string;
};

export type ContactActor =
  | { role: "ai"; id: string }
  | { role: "human"; id: string };

export type AiActorAuthResult =
  | { ok: true; actor: { id: string } }
  | { ok: false; response: NextResponse };

function verifyTestHumanToken(humanId: string, token: string): boolean {
  if (!humanId || !token) return false;
  if (process.env.NODE_ENV === "production") return false;
  if (process.env.ENABLE_TEST_HUMAN_AUTH !== "true") return false;
  const secret = process.env.TEST_HUMAN_AUTH_SECRET || "";
  if (!secret) return false;
  const expected = crypto.createHmac("sha256", secret).update(humanId).digest("hex");
  // Constant-time compare to avoid leaking token validity.
  const a = Buffer.from(expected);
  const b = Buffer.from(token);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export async function verifyAiActor(
  _db: DbClient,
  aiAccountId: string,
  aiApiKey: string
): Promise<{ id: string } | null> {
  const result = await verifyAiActorDetailed(_db, aiAccountId, aiApiKey);
  if (!result.ok) return null;
  return result.actor;
}

export async function verifyAiActorDetailed(
  _db: DbClient,
  aiAccountId: string,
  aiApiKey: string
): Promise<AiActorAuthResult> {
  const auth = await authenticateAiApiRequest(aiAccountId, aiApiKey);
  if (auth.ok === false) {
    return { ok: false, response: auth.response };
  }
  return { ok: true, actor: { id: auth.aiAccountId } };
}

export async function resolveActorFromRequest(
  db: DbClient,
  task: TaskForContact,
  request: Request,
  payload?: any
): Promise<ContactActor | null> {
  const fromPayloadAiId =
    typeof payload?.ai_account_id === "string" ? payload.ai_account_id.trim() : "";
  const fromPayloadAiKey =
    typeof payload?.ai_api_key === "string" ? payload.ai_api_key.trim() : "";
  if (fromPayloadAiId && fromPayloadAiKey) {
    const aiActor = await verifyAiActor(db, fromPayloadAiId, fromPayloadAiKey);
    if (!aiActor || task.ai_account_id !== aiActor.id) return null;
    return { role: "ai", id: aiActor.id };
  }

  const url = new URL(request.url);
  const qAiId = parseAiAccountIdFromRequest(request, url);
  const qAiKey = parseAiApiKeyFromRequest(request);
  if (qAiId && qAiKey) {
    const aiActor = await verifyAiActor(db, qAiId, qAiKey);
    if (!aiActor || task.ai_account_id !== aiActor.id) return null;
    return { role: "ai", id: aiActor.id };
  }

  const fromPayloadHumanId =
    typeof payload?.human_id === "string" ? payload.human_id.trim() : "";
  const fromPayloadHumanToken =
    typeof payload?.human_test_token === "string" ? payload.human_test_token.trim() : "";
  if (
    fromPayloadHumanId &&
    fromPayloadHumanToken &&
    task.human_id === fromPayloadHumanId &&
    verifyTestHumanToken(fromPayloadHumanId, fromPayloadHumanToken)
  ) {
    return { role: "human", id: fromPayloadHumanId };
  }

  const qHumanId = (request.headers.get("x-human-id") || "").trim();
  const qHumanToken = (request.headers.get("x-human-test-token") || "").trim();
  if (
    qHumanId &&
    qHumanToken &&
    task.human_id === qHumanId &&
    verifyTestHumanToken(qHumanId, qHumanToken)
  ) {
    return { role: "human", id: qHumanId };
  }

  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return null;
  const humanId = await getCurrentHumanIdByEmail(email);
  if (!humanId || task.human_id !== humanId) return null;
  return { role: "human", id: humanId };
}
