import { getDb } from "@/lib/db";

export async function getCurrentHumanIdByEmail(email: string): Promise<string | null> {
  const db = getDb();
  const row = await db
    .prepare(`SELECT id FROM humans WHERE email = ? ORDER BY created_at DESC LIMIT 1`)
    .get<{ id: string }>(email);
  return row?.id ?? null;
}
