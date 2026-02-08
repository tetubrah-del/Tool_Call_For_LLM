import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAdminToken } from "@/lib/admin-auth";

function toCsvValue(value: string | number | null | undefined) {
  if (value == null) return "";
  const text = String(value);
  if (text.includes(",") || text.includes("\"") || text.includes("\n")) {
    return `"${text.replace(/"/g, "\"\"")}"`;
  }
  return text;
}

export async function GET(request: Request) {
  const authError = requireAdminToken(request);
  if (authError) return authError;

  const db = getDb();
  const rows = await db
    .prepare(
      `SELECT
        id,
        task,
        budget_usd,
        fee_rate,
        fee_amount,
        paypal_fee_amount,
        payout_amount,
        paid_status,
        approved_at,
        paid_at,
        paid_method,
        payout_batch_id,
        payment_error_message,
        ai_account_id,
        payer_paypal_email,
        payee_paypal_email,
        human_id,
        created_at
       FROM tasks
       WHERE paid_status = 'paid'
       ORDER BY paid_at DESC`
    )
    .all() as Array<Record<string, any>>;

  const header = [
    "id",
    "task",
    "budget_usd",
    "fee_rate",
    "fee_amount",
    "paypal_fee_amount",
    "payout_amount",
    "paid_status",
    "approved_at",
    "paid_at",
    "paid_method",
    "payout_batch_id",
    "payment_error_message",
    "ai_account_id",
    "payer_paypal_email",
    "payee_paypal_email",
    "human_id",
    "created_at"
  ];

  const lines = [header.join(",")];
  for (const row of rows) {
    const line = header.map((key) => toCsvValue(row[key])).join(",");
    lines.push(line);
  }

  const csv = lines.join("\n");
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename=\"payments.csv\""
    }
  });
}
