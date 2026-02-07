import crypto from "crypto";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { normalizeCountry } from "@/lib/country";

async function parseRequest(request: Request) {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return request.json();
  }
  const form = await request.formData();
  return Object.fromEntries(form.entries());
}

export async function GET() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json({ status: "unauthorized" }, { status: 401 });
  }

  const db = getDb();
  const profile = db
    .prepare(`SELECT * FROM humans WHERE email = ? ORDER BY created_at DESC LIMIT 1`)
    .get(email);

  return NextResponse.json({ profile: profile || null });
}

export async function POST(request: Request) {
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
  const minBudgetUsd = Number(payload?.min_budget_usd);

  if (!name || !Number.isFinite(minBudgetUsd) || !country) {
    return NextResponse.json(
      { status: "error", reason: "invalid_request" },
      { status: 400 }
    );
  }

  const db = getDb();
  const existing = db
    .prepare(`SELECT * FROM humans WHERE email = ? ORDER BY created_at DESC LIMIT 1`)
    .get(email) as { id: string } | undefined;

  if (existing?.id) {
    db.prepare(
      `UPDATE humans SET name = ?, location = ?, country = ?, min_budget_usd = ? WHERE id = ?`
    ).run(name, location, country, minBudgetUsd, existing.id);

    return NextResponse.json({ id: existing.id, status: "available" });
  }

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO humans (id, name, email, location, country, min_budget_usd, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'available', ?)`
  ).run(id, name, email, location, country, minBudgetUsd, createdAt);

  return NextResponse.json({ id, status: "available" });
}
