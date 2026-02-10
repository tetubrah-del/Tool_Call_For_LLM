import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { calculatePayout, normalizePaymentStatus } from "@/lib/payments";
import { requireAdminToken } from "@/lib/admin-auth";

export async function POST(
  request: Request,
  { params }: { params: { taskId: string } }
) {
  const authError = requireAdminToken(request);
  if (authError) return authError;

  const payload: any = await request.json().catch(() => ({}));
  const action =
    payload?.action === "approve" ||
    payload?.action === "mark_paid" ||
    payload?.action === "mark_failed"
      ? payload.action
      : "mark_paid";

  const db = getDb();
  const task = await db
    .prepare(`SELECT * FROM tasks WHERE id = ? AND deleted_at IS NULL`)
    .get(params.taskId);
  if (!task) {
    return NextResponse.json({ status: "not_found" }, { status: 404 });
  }
  if (task.status !== "completed") {
    return NextResponse.json(
      { status: "error", reason: "not_completed" },
      { status: 409 }
    );
  }
  const currentStatus = normalizePaymentStatus(task.paid_status);
  if (action !== "mark_failed" && currentStatus === "paid") {
    return NextResponse.json(
      { status: "error", reason: "already_paid" },
      { status: 409 }
    );
  }

  if (action === "approve") {
    if (currentStatus === "approved") {
      return NextResponse.json({ status: "approved", task_id: params.taskId });
    }
    const approvedAt = new Date().toISOString();
    await db.prepare(
      `UPDATE tasks
       SET paid_status = 'approved',
           approved_at = ?,
           payment_error_message = NULL
       WHERE id = ?`
    ).run(approvedAt, params.taskId);
    return NextResponse.json({
      status: "approved",
      task_id: params.taskId,
      approved_at: approvedAt
    });
  }

  if (action === "mark_failed") {
    const message =
      typeof payload?.error_message === "string" ? payload.error_message.trim() : "";
    await db.prepare(
      `UPDATE tasks
       SET paid_status = 'failed',
           payment_error_message = ?
       WHERE id = ?`
    ).run(message || null, params.taskId);

    return NextResponse.json({
      status: "failed",
      task_id: params.taskId,
      error_message: message || null
    });
  }

  if (currentStatus !== "approved") {
    return NextResponse.json(
      { status: "error", reason: "not_approved" },
      { status: 409 }
    );
  }

  const paypalFeeUsd = Number(payload?.paypal_fee_usd ?? 0);
  if (!Number.isFinite(paypalFeeUsd) || paypalFeeUsd < 0) {
    return NextResponse.json(
      { status: "error", reason: "invalid_paypal_fee" },
      { status: 400 }
    );
  }
  const payoutBatchId =
    typeof payload?.payout_batch_id === "string" && payload.payout_batch_id.trim().length > 0
      ? payload.payout_batch_id.trim()
      : null;

  const breakdown = calculatePayout(Number(task.budget_usd), paypalFeeUsd);
  const paidAt = new Date().toISOString();

  await db.prepare(
    `UPDATE tasks
     SET paid_status = 'paid',
         paid_at = ?,
         paid_method = 'paypal',
         fee_rate = ?,
         fee_amount = ?,
         payout_amount = ?,
         paypal_fee_amount = ?,
         payout_batch_id = ?,
         payment_error_message = NULL
     WHERE id = ?`
  ).run(
    paidAt,
    breakdown.fee_rate,
    breakdown.fee_amount,
    breakdown.payout_amount,
    breakdown.paypal_fee_amount,
    payoutBatchId,
    params.taskId
  );

  return NextResponse.json({
    status: "paid",
    task_id: params.taskId,
    paid_at: paidAt,
    paid_method: "paypal",
    payout_batch_id: payoutBatchId,
    ...breakdown
  });
}
