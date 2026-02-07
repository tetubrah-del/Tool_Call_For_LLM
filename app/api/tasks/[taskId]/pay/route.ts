import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { calculatePayout } from "@/lib/payments";
import { requireAdminToken } from "@/lib/admin-auth";

export async function POST(
  request: Request,
  { params }: { params: { taskId: string } }
) {
  const authError = requireAdminToken(request);
  if (authError) return authError;

  const payload: any = await request.json().catch(() => ({}));
  const paypalFeeUsd = Number(payload?.paypal_fee_usd ?? 0);

  if (!Number.isFinite(paypalFeeUsd) || paypalFeeUsd < 0) {
    return NextResponse.json(
      { status: "error", reason: "invalid_paypal_fee" },
      { status: 400 }
    );
  }

  const db = getDb();
  const task = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(params.taskId);
  if (!task) {
    return NextResponse.json({ status: "not_found" }, { status: 404 });
  }
  if (task.status !== "completed") {
    return NextResponse.json(
      { status: "error", reason: "not_completed" },
      { status: 409 }
    );
  }
  if (task.paid_status === "paid") {
    return NextResponse.json(
      { status: "error", reason: "already_paid" },
      { status: 409 }
    );
  }

  const breakdown = calculatePayout(Number(task.budget_usd), paypalFeeUsd);
  const paidAt = new Date().toISOString();

  db.prepare(
    `UPDATE tasks
     SET paid_status = 'paid',
         paid_at = ?,
         paid_method = 'paypal',
         fee_rate = ?,
         fee_amount = ?,
         payout_amount = ?,
         paypal_fee_amount = ?
     WHERE id = ?`
  ).run(
    paidAt,
    breakdown.fee_rate,
    breakdown.fee_amount,
    breakdown.payout_amount,
    breakdown.paypal_fee_amount,
    params.taskId
  );

  return NextResponse.json({
    status: "paid",
    task_id: params.taskId,
    paid_at: paidAt,
    paid_method: "paypal",
    ...breakdown
  });
}
