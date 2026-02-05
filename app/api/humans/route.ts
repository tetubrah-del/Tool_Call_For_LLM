import crypto from "crypto";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

async function parseRequest(request: Request) {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return request.json();
  }
  const form = await request.formData();
  return Object.fromEntries(form.entries());
}

export async function POST(request: Request) {
  const payload: any = await parseRequest(request);
  const name = typeof payload?.name === "string" ? payload.name.trim() : "";
  const rawLocation =
    typeof payload?.location === "string" ? payload.location.trim() : "";
  const location = rawLocation.length > 0 ? rawLocation : null;
  const minBudgetUsd = Number(payload?.min_budget_usd);

  if (!name || !Number.isFinite(minBudgetUsd)) {
    return NextResponse.json(
      { status: "error", reason: "invalid_request" },
      { status: 400 }
    );
  }

  const db = getDb();
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  db.prepare(
    `INSERT INTO humans (id, name, location, min_budget_usd, status, created_at)
     VALUES (?, ?, ?, ?, 'available', ?)`
  ).run(id, name, location, minBudgetUsd, createdAt);

  const acceptsHtml = request.headers.get("accept")?.includes("text/html");
  if (acceptsHtml) {
    return NextResponse.redirect(new URL(`/tasks?human_id=${id}`, request.url));
  }

  return NextResponse.json({ id, status: "available" });
}

export async function GET() {
  const db = getDb();
  const humans = db.prepare(`SELECT * FROM humans ORDER BY created_at DESC`).all();
  return NextResponse.json({ humans });
}
