import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getNormalizedTask } from "@/lib/task-api";
import { OPERATOR_COUNTRY } from "@/lib/payments";

export async function GET(
  request: Request,
  { params }: { params: { taskId: string } }
) {
  const db = getDb();
  const url = new URL(request.url);
  const lang = url.searchParams.get("lang");
  const humanId = url.searchParams.get("human_id");
  const task = await getNormalizedTask(db, params.taskId, lang);
  if (!task) {
    return NextResponse.json({ status: "not_found" }, { status: 404 });
  }
  let isInternationalPayout = false;
  if (humanId) {
    const human = db.prepare(`SELECT * FROM humans WHERE id = ?`).get(humanId);
    if (human?.country) {
      isInternationalPayout = human.country !== OPERATOR_COUNTRY;
    }
  }
  return NextResponse.json({
    task: { ...task, is_international_payout: isInternationalPayout }
  });
}
