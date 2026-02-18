import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const redirect = new URL("/api/tiktok/callback", url.origin);
  url.searchParams.forEach((value, key) => {
    redirect.searchParams.append(key, value);
  });
  return NextResponse.redirect(redirect, { status: 302 });
}
