import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getNormalizedTask } from "@/lib/task-api";
import { dispatchTaskEvent } from "@/lib/webhooks";

async function parseRequest(request: Request) {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return request.json();
  }
  const form = await request.formData();
  return Object.fromEntries(form.entries());
}

export async function POST(
  request: Request,
  { params }: { params: { taskId: string } }
) {
  const payload: any = await parseRequest(request);
  const humanId = typeof payload?.human_id === "string" ? payload.human_id : "";

  if (!humanId) {
    return NextResponse.json({ status: "error", reason: "missing_human" }, { status: 400 });
  }

  const db = getDb();
  const task = await getNormalizedTask(db, params.taskId, "en");
  const human = db.prepare(`SELECT * FROM humans WHERE id = ?`).get(humanId);

  if (!task || !human) {
    return NextResponse.json({ status: "not_found" }, { status: 404 });
  }

  if (task.status === "failed" && task.failure_reason === "timeout") {
    return NextResponse.json({ status: "error", reason: "timeout" }, { status: 409 });
  }

  if (task.status === "completed") {
    return NextResponse.json({ status: "error", reason: "already_completed" }, { status: 409 });
  }

  if (task.human_id && task.human_id !== humanId) {
    return NextResponse.json({ status: "error", reason: "already_assigned" }, { status: 409 });
  }

  if (!human.paypal_email) {
    return NextResponse.json({ status: "error", reason: "invalid_request" }, { status: 400 });
  }

  db.prepare(
    `UPDATE tasks SET status = 'accepted', human_id = ?, payee_paypal_email = ? WHERE id = ?`
  ).run(
    humanId,
    human.paypal_email,
    params.taskId
  );
  db.prepare(`UPDATE humans SET status = 'busy' WHERE id = ?`).run(humanId);
  void dispatchTaskEvent(db, { eventType: "task.accepted", taskId: params.taskId }).catch(
    () => {}
  );

  return NextResponse.json({ status: "accepted", task_id: params.taskId });
}
