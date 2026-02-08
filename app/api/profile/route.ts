import crypto from "crypto";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { normalizeCountry } from "@/lib/country";
import { normalizePaypalEmail } from "@/lib/paypal";

async function parseRequest(request: Request) {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return request.json();
  }
  const form = await request.formData();
  return Object.fromEntries(form.entries());
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    const email = session?.user?.email;
    if (!email) {
      return NextResponse.json({ status: "unauthorized" }, { status: 401 });
    }

    const db = getDb();
    const profile = await db
      .prepare(`SELECT * FROM humans WHERE email = ? ORDER BY created_at DESC LIMIT 1`)
      .get(email);

    return NextResponse.json({ profile: profile || null });
  } catch (error) {
    console.error("GET /api/profile failed", error);
    return NextResponse.json(
      { status: "error", reason: "internal_error" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    const email = session?.user?.email;
    if (!email) {
      return NextResponse.json({ status: "unauthorized" }, { status: 401 });
    }

    const payload: any = await parseRequest(request);
    const name = typeof payload?.name === "string" ? payload.name.trim() : "";
    const rawLocation =
      typeof payload?.location === "string" ? payload.location.trim() : "";
    const location = rawLocation.length > 0 ? rawLocation : null;
    const country = normalizeCountry(payload?.country);
    const paypalEmail = normalizePaypalEmail(payload?.paypal_email);
    const minBudgetUsd = Number(payload?.min_budget_usd);

    if (!name || !Number.isFinite(minBudgetUsd) || !country || !paypalEmail) {
      return NextResponse.json(
        { status: "error", reason: "invalid_request" },
        { status: 400 }
      );
    }

    const db = getDb();
    const existing = await db
      .prepare(`SELECT * FROM humans WHERE email = ? ORDER BY created_at DESC LIMIT 1`)
      .get<{ id: string }>(email);

    if (existing?.id) {
      await db.prepare(
        `UPDATE humans SET name = ?, location = ?, country = ?, min_budget_usd = ?, paypal_email = ? WHERE id = ?`
      ).run(name, location, country, minBudgetUsd, paypalEmail, existing.id);

      return NextResponse.json({ id: existing.id, status: "available" });
    }

    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    await db.prepare(
      `INSERT INTO humans (id, name, email, paypal_email, location, country, min_budget_usd, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'available', ?)`
    ).run(id, name, email, paypalEmail, location, country, minBudgetUsd, createdAt);

    return NextResponse.json({ id, status: "available" });
  } catch (error) {
    console.error("POST /api/profile failed", error);
    return NextResponse.json(
      { status: "error", reason: "internal_error" },
      { status: 500 }
    );
  }
}
