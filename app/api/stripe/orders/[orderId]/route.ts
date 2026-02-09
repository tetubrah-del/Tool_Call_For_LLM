import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET(
  _request: Request,
  { params }: { params: { orderId: string } }
) {
  try {
    const orderId = params.orderId;
    const url = new URL(_request.url);
    const version = url.searchParams.get("version");
    const v = version == null ? 1 : Number(version);
    if (!Number.isInteger(v) || v <= 0) {
      return NextResponse.json({ status: "error", reason: "invalid_version" }, { status: 400 });
    }

    const db = getDb();
    const order = await db
      .prepare(`SELECT * FROM orders WHERE id = ? AND version = ?`)
      .get(orderId, v);
    if (!order) {
      return NextResponse.json({ status: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ status: "ok", order });
  } catch (err) {
    console.error("GET /api/stripe/orders/:orderId failed", err);
    return NextResponse.json({ status: "error", reason: "internal_error" }, { status: 500 });
  }
}

