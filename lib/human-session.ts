import { getDb } from "@/lib/db";

export function getCurrentHumanIdByEmail(email: string): string | null {
  const db = getDb();
  const row = db
    .prepare(`SELECT id FROM humans WHERE email = ? ORDER BY created_at DESC LIMIT 1`)
    .get(email) as { id: string } | undefined;
  return row?.id ?? null;
}
