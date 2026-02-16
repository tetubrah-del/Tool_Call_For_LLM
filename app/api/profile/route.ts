import crypto from "crypto";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { normalizeCountry } from "@/lib/country";
import { authenticateHumanRequest, finalizeHumanAuthResponse } from "@/lib/human-api-auth";
import { normalizePaypalEmail } from "@/lib/paypal";
import { getRequestCountry } from "@/lib/request-country";
import { isSameOriginRequest } from "@/lib/same-origin";

function normalizeOptionalString(value: unknown, maxLen: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > maxLen ? trimmed.slice(0, maxLen) : trimmed;
}

function normalizeOptionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeSkills(value: unknown): string | null {
  // Stored as JSON array string for forward compatibility.
  const maxSkills = 50;
  const maxSkillLen = 40;

  let raw: unknown[] = [];
  if (Array.isArray(value)) {
    raw = value;
  } else if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    // Accept either JSON array or comma-separated for backward compatibility.
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        raw = parsed;
      } else {
        raw = trimmed.split(",");
      }
    } catch {
      raw = trimmed.split(",");
    }
  } else {
    return null;
  }

  const skills = raw
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter(Boolean)
    .map((v) => (v.length > maxSkillLen ? v.slice(0, maxSkillLen) : v))
    .slice(0, maxSkills);

  if (skills.length === 0) return null;
  return JSON.stringify(skills);
}

const ALLOWED_GENDERS = new Set([
  "unspecified",
  "male",
  "female",
  "nonbinary",
  "other",
  "prefer_not_to_say"
]);

async function parseRequest(request: Request) {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return request.json();
  }
  const form = await request.formData();
  return Object.fromEntries(form.entries());
}

export async function GET(request: Request) {
  try {
    const auth = await authenticateHumanRequest(request, "profile:read");
    if (auth.ok === false) return auth.response;
    const requestCountry = getRequestCountry(request);

    const db = getDb();
    const profile = await db
      .prepare(
        `SELECT * FROM humans WHERE id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1`
      )
      .get(auth.humanId);

    const response = NextResponse.json({
      profile: profile || null,
      request_country: requestCountry
    });
    return finalizeHumanAuthResponse(request, response, auth);
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
    if (!isSameOriginRequest(request)) {
      return NextResponse.json({ status: "error", reason: "forbidden" }, { status: 403 });
    }

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
    const minBudgetUsdRaw = Number(payload?.min_budget_usd);
    const minBudgetUsd = Number.isFinite(minBudgetUsdRaw) && minBudgetUsdRaw >= 0 ? minBudgetUsdRaw : 0;
    const headline = normalizeOptionalString(payload?.headline, 120);
    const genderRaw = typeof payload?.gender === "string" ? payload.gender.trim() : "";
    const gender = genderRaw && ALLOWED_GENDERS.has(genderRaw) ? genderRaw : null;
    const bio = normalizeOptionalString(payload?.bio, 4000);
    const city = normalizeOptionalString(payload?.city, 80);
    const region = normalizeOptionalString(payload?.region, 80);
    const timezone = normalizeOptionalString(payload?.timezone, 64);
    const hourlyRateUsd = normalizeOptionalNumber(payload?.hourly_rate_usd);
    const skillsJson = normalizeSkills(payload?.skills);
    const twitterUrl = normalizeOptionalString(payload?.twitter_url, 240);
    const githubUrl = normalizeOptionalString(payload?.github_url, 240);
    const instagramUrl = normalizeOptionalString(payload?.instagram_url, 240);
    const linkedinUrl = normalizeOptionalString(payload?.linkedin_url, 240);
    const websiteUrl = normalizeOptionalString(payload?.website_url, 240);
    const youtubeUrl = normalizeOptionalString(payload?.youtube_url, 240);

    if (!name || !country) {
      return NextResponse.json(
        { status: "error", reason: "invalid_request" },
        { status: 400 }
      );
    }

    const db = getDb();
    const existing = await db
      .prepare(
        `SELECT * FROM humans WHERE email = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1`
      )
      .get<{ id: string }>(email);

    if (existing?.id) {
      await db.prepare(
        `UPDATE humans
         SET
           name = ?,
           location = ?,
           country = ?,
           min_budget_usd = ?,
           paypal_email = ?,
           headline = ?,
           gender = ?,
           bio = ?,
           city = ?,
           region = ?,
           timezone = ?,
           hourly_rate_usd = ?,
           skills_json = ?,
           twitter_url = ?,
           github_url = ?,
           instagram_url = ?,
           linkedin_url = ?,
           website_url = ?,
           youtube_url = ?
         WHERE id = ?`
      ).run(
        name,
        location,
        country,
        minBudgetUsd,
        paypalEmail,
        headline,
        gender,
        bio,
        city,
        region,
        timezone,
        hourlyRateUsd,
        skillsJson,
        twitterUrl,
        githubUrl,
        instagramUrl,
        linkedinUrl,
        websiteUrl,
        youtubeUrl,
        existing.id
      );

      return NextResponse.json({ id: existing.id, status: "available" });
    }

    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    await db.prepare(
      `INSERT INTO humans (
         id,
         name,
         email,
         paypal_email,
         location,
         country,
         min_budget_usd,
         headline,
         gender,
         bio,
         city,
         region,
         timezone,
         hourly_rate_usd,
         skills_json,
         twitter_url,
         github_url,
         instagram_url,
         linkedin_url,
         website_url,
         youtube_url,
         status,
         created_at
       )
       VALUES (
         ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'available', ?
       )`
    ).run(
      id,
      name,
      email,
      paypalEmail,
      location,
      country,
      minBudgetUsd,
      headline,
      gender,
      bio,
      city,
      region,
      timezone,
      hourlyRateUsd,
      skillsJson,
      twitterUrl,
      githubUrl,
      instagramUrl,
      linkedinUrl,
      websiteUrl,
      youtubeUrl,
      createdAt
    );

    return NextResponse.json({ id, status: "available" });
  } catch (error) {
    console.error("POST /api/profile failed", error);
    return NextResponse.json(
      { status: "error", reason: "internal_error" },
      { status: 500 }
    );
  }
}
