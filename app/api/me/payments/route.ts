import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { authenticateHumanRequest, finalizeHumanAuthResponse } from "@/lib/human-api-auth";
import { calculatePayout, normalizePaymentStatus } from "@/lib/payments";
import { getRequestCountry } from "@/lib/request-country";

type PaymentRow = {
  id: string;
  task: string;
  budget_usd: number;
  fee_amount: number | null;
  payout_amount: number | null;
  paypal_fee_amount: number | null;
  paid_status: string | null;
  approved_at: string | null;
  paid_at: string | null;
  payment_error_message: string | null;
  payout_batch_id: string | null;
  created_at: string;
};

export async function GET(request: Request) {
  const auth = await authenticateHumanRequest(request, "payments:read");
  if (auth.ok === false) return auth.response;
  const requestCountry = getRequestCountry(request);

  let response: NextResponse;
  try {
    const humanId = auth.humanId;
    if (!humanId) {
      response = NextResponse.json({
        human_id: null,
        human_country: null,
        request_country: requestCountry,
        summary: { pending_total: 0, approved_total: 0, paid_total: 0 },
        payments: []
      });
      return await finalizeHumanAuthResponse(request, response, auth);
    }

    const db = getDb();
    const human = await db
      .prepare(`SELECT country FROM humans WHERE id = ? AND deleted_at IS NULL`)
      .get<{ country: string | null }>(humanId);
    const rows = await db
      .prepare(
        `SELECT
           id,
           task,
           budget_usd,
           fee_amount,
           payout_amount,
           paypal_fee_amount,
           paid_status,
           approved_at,
           paid_at,
           payment_error_message,
           payout_batch_id,
         created_at
         FROM tasks
         WHERE human_id = ?
           AND status IN ('review_pending', 'completed')
         ORDER BY created_at DESC`
      )
      .all<PaymentRow>(humanId);

    let pendingTotal = 0;
    let approvedTotal = 0;
    let paidTotal = 0;

    const payments = rows.map((row) => {
      const status = normalizePaymentStatus(row.paid_status);
      const computed = calculatePayout(
        Number(row.budget_usd),
        Number(row.paypal_fee_amount ?? 0)
      );
      const feeAmount = row.fee_amount ?? computed.fee_amount;
      const payoutAmount = row.payout_amount ?? computed.payout_amount;
      const paypalFeeAmount = row.paypal_fee_amount ?? computed.paypal_fee_amount;

      if (status === "pending") pendingTotal += payoutAmount;
      if (status === "approved") approvedTotal += payoutAmount;
      if (status === "paid") paidTotal += payoutAmount;

      return {
        task_id: row.id,
        task: row.task,
        gross_amount: Number(row.budget_usd),
        platform_fee: feeAmount,
        paypal_fee: paypalFeeAmount,
        net_amount: payoutAmount,
        status,
        approved_at: row.approved_at ?? null,
        paid_at: row.paid_at ?? null,
        payout_batch_id: row.payout_batch_id ?? null,
        error_message: row.payment_error_message ?? null,
        updated_at: row.paid_at ?? row.approved_at ?? row.created_at
      };
    });

    response = NextResponse.json({
      human_id: humanId,
      human_country: human?.country || null,
      request_country: requestCountry,
      summary: {
        pending_total: Number(pendingTotal.toFixed(2)),
        approved_total: Number(approvedTotal.toFixed(2)),
        paid_total: Number(paidTotal.toFixed(2))
      },
      payments
    });
  } catch {
    response = NextResponse.json({ status: "error", reason: "internal_error" }, { status: 500 });
  }

  return finalizeHumanAuthResponse(request, response, auth);
}
