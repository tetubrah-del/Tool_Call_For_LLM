import { NextResponse } from "next/server";
import { readR2Upload } from "@/lib/storage";

export async function GET(
  _request: Request,
  context: { params: Promise<{ key: string[] }> }
) {
  const { key } = await context.params;
  const objectKey = Array.isArray(key) ? key.join("/") : "";
  if (!objectKey) {
    return NextResponse.json({ status: "not_found" }, { status: 404 });
  }

  try {
    const object = await readR2Upload(objectKey);
    const headers = new Headers();
    headers.set("Content-Type", object.contentType);
    if (object.contentLength != null) {
      headers.set("Content-Length", String(object.contentLength));
    }
    headers.set("Cache-Control", "public, max-age=31536000, immutable");
    return new Response(object.stream, { status: 200, headers });
  } catch (error: any) {
    const message = error instanceof Error ? error.message : "read_failed";
    if (message === "r2_not_configured") {
      return NextResponse.json(
        { status: "error", reason: "storage_not_configured" },
        { status: 503 }
      );
    }
    if (message === "NoSuchKey" || message === "object_not_found") {
      return NextResponse.json({ status: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ status: "error", reason: "storage_read_failed" }, { status: 500 });
  }
}
