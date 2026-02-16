import { NextResponse } from "next/server";
import { readR2Upload } from "@/lib/storage";

function isObjectNotFound(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as any;
  const message = typeof e.message === "string" ? e.message : "";
  const name = typeof e.name === "string" ? e.name : "";
  const code = typeof e.Code === "string" ? e.Code : typeof e.code === "string" ? e.code : "";
  const httpStatus = Number(e?.$metadata?.httpStatusCode);
  return (
    message === "object_not_found" ||
    message === "NoSuchKey" ||
    message.includes("does not exist") ||
    name === "NoSuchKey" ||
    code === "NoSuchKey" ||
    httpStatus === 404
  );
}

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
    if (isObjectNotFound(error)) {
      return NextResponse.json({ status: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ status: "error", reason: "storage_read_failed" }, { status: 500 });
  }
}
