import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

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

function tryOrigin(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function normalizeProto(value: string | null): "http" | "https" {
  const raw = (value || "").split(",")[0].trim().toLowerCase();
  return raw === "http" ? "http" : "https";
}

function normalizeHost(value: string | null): string | null {
  const raw = (value || "").split(",")[0].trim().toLowerCase();
  return raw || null;
}

function buildForwardedOrigin(request: Request): string | null {
  const proto = normalizeProto(
    request.headers.get("x-forwarded-proto") ||
    request.headers.get("x-forwarded-protocol")
  );
  const host =
    normalizeHost(request.headers.get("x-forwarded-host")) ||
    normalizeHost(request.headers.get("host"));
  if (!host) return null;
  return `${proto}://${host}`;
}

function isSameOrigin(request: Request): boolean {
  // CSRF defense: for state-changing endpoints, require same-origin browser requests.
  // In proxied environments (e.g. Render), request.url origin can differ from the public host.
  const browserOrigin =
    tryOrigin(request.headers.get("origin")) ||
    tryOrigin(request.headers.get("referer"));
  if (!browserOrigin) return false;

  const candidates = new Set<string>();
  const reqOrigin = tryOrigin(request.url);
  if (reqOrigin) candidates.add(reqOrigin);
  const fwdOrigin = buildForwardedOrigin(request);
  if (fwdOrigin) candidates.add(fwdOrigin);

  for (const c of candidates) {
    if (browserOrigin === c) return true;
  }
  return false;
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
  if (method !== "GET" && !isSameOrigin(request)) {
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
