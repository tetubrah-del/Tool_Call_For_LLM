import type Database from "better-sqlite3";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
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

export function verifyAiActor(
  db: Database,
  aiAccountId: string,
  aiApiKey: string
): { id: string } | null {
  if (!aiAccountId || !aiApiKey) return null;
  const aiAccount = db
    .prepare(`SELECT id, api_key, status FROM ai_accounts WHERE id = ?`)
    .get(aiAccountId) as { id: string; api_key: string; status: string } | undefined;
  if (!aiAccount) return null;
  if (aiAccount.api_key !== aiApiKey || aiAccount.status !== "active") return null;
  return { id: aiAccount.id };
}

export async function resolveActorFromRequest(
  db: Database,
  task: TaskForContact,
  request: Request,
  payload?: any
): Promise<ContactActor | null> {
  const fromPayloadAiId =
    typeof payload?.ai_account_id === "string" ? payload.ai_account_id.trim() : "";
  const fromPayloadAiKey =
    typeof payload?.ai_api_key === "string" ? payload.ai_api_key.trim() : "";
  if (fromPayloadAiId && fromPayloadAiKey) {
    const aiActor = verifyAiActor(db, fromPayloadAiId, fromPayloadAiKey);
    if (!aiActor || task.ai_account_id !== aiActor.id) return null;
    return { role: "ai", id: aiActor.id };
  }

  const url = new URL(request.url);
  const qAiId = (url.searchParams.get("ai_account_id") || "").trim();
  const qAiKey = (url.searchParams.get("ai_api_key") || "").trim();
  if (qAiId && qAiKey) {
    const aiActor = verifyAiActor(db, qAiId, qAiKey);
    if (!aiActor || task.ai_account_id !== aiActor.id) return null;
    return { role: "ai", id: aiActor.id };
  }

  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return null;
  const humanId = getCurrentHumanIdByEmail(email);
  if (!humanId || task.human_id !== humanId) return null;
  return { role: "human", id: humanId };
}
