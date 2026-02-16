import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isSameOriginRequest } from "@/lib/same-origin";

function parseAdminEmails(raw: string | undefined): Set<string> {
  const out = new Set<string>();
  const value = (raw || "").trim();
  if (!value) return out;
  for (const part of value.split(",")) {
    const email = part.trim().toLowerCase();
    if (email && email.includes("@")) out.add(email);
  }
  return out;
}

export async function requireAdmin(request: Request) {
  const allowlist = parseAdminEmails(process.env.ADMIN_EMAILS);
  if (allowlist.size === 0) {
    return NextResponse.json(
      { status: "error", reason: "admin_emails_not_configured" },
      { status: 500 }
    );
  }

  // For non-GET, enforce same-origin.
  const method = (request.method || "GET").toUpperCase();
  if (method !== "GET" && !isSameOriginRequest(request)) {
    return NextResponse.json({ status: "error", reason: "forbidden" }, { status: 403 });
  }

  const session = await getServerSession(authOptions);
  const email = session?.user?.email ? String(session.user.email).toLowerCase() : "";
  if (!email) {
    return NextResponse.json({ status: "error", reason: "unauthorized" }, { status: 401 });
  }
  if (!allowlist.has(email)) {
    return NextResponse.json({ status: "error", reason: "forbidden" }, { status: 403 });
  }

  return null;
}

export async function assertAdminPageAccess() {
  const allowlist = parseAdminEmails(process.env.ADMIN_EMAILS);
  if (allowlist.size === 0) return { ok: false as const, reason: "admin_emails_not_configured" };

  const session = await getServerSession(authOptions);
  const email = session?.user?.email ? String(session.user.email).toLowerCase() : "";
  if (!email) return { ok: false as const, reason: "unauthorized" };
  if (!allowlist.has(email)) return { ok: false as const, reason: "forbidden" };
  return { ok: true as const, email };
}
