import crypto from "crypto";
import { NextResponse } from "next/server";

function secureEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function readApiKeyFromRequest(request: Request) {
  const auth = request.headers.get("authorization") || "";
  if (auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  return (request.headers.get("x-marketing-api-key") || "").trim();
}

export function requireMarketingApiKey(request: Request) {
  const expected = (process.env.MARKETING_API_KEY || "").trim();
  if (!expected) {
    return NextResponse.json(
      { status: "error", reason: "marketing_api_not_configured" },
      { status: 503 }
    );
  }

  const actual = readApiKeyFromRequest(request);
  if (!actual || !secureEqual(actual, expected)) {
    return NextResponse.json({ status: "error", reason: "unauthorized" }, { status: 401 });
  }

  return null;
}
