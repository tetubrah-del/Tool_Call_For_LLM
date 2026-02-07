import { NextResponse } from "next/server";

export function requireAdminToken(request: Request) {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) {
    return NextResponse.json(
      { status: "error", reason: "admin_token_not_configured" },
      { status: 500 }
    );
  }
  const headerToken = request.headers.get("x-admin-token");
  const url = new URL(request.url);
  const queryToken = url.searchParams.get("token");
  const provided = headerToken || queryToken;
  if (!provided || provided !== expected) {
    return NextResponse.json(
      { status: "error", reason: "unauthorized" },
      { status: 401 }
    );
  }
  return null;
}
