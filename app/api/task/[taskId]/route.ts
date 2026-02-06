import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getNormalizedTask } from "@/lib/task-api";

export async function GET(
  request: Request,
  { params }: { params: { taskId: string } }
) {
  const db = getDb();
  const url = new URL(request.url);
  const lang = url.searchParams.get("lang");
  const task = await getNormalizedTask(db, params.taskId, lang);
  if (!task) {
    return NextResponse.json({ status: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ task });
}
