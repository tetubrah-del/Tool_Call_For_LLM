import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireMarketingApiKey } from "@/lib/marketing-api-auth";

type RouteContext = {
  params: Promise<{ jobId: string }>;
};

function normalizeText(value: unknown, max = 200) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

export async function GET(request: Request, context: RouteContext) {
  const authError = requireMarketingApiKey(request);
  if (authError) return authError;

  const { jobId } = await context.params;
  const id = normalizeText(jobId, 120);
  if (!id) {
    return NextResponse.json({ status: "error", reason: "invalid_request" }, { status: 400 });
  }

  const db = getDb();
  const job = await db
    .prepare(
      `SELECT id, content_id, asset_type, provider, model, status,
              prompt, prompt_negative, seed, request_json, response_json,
              error_code, error_message, retryable, attempt_count,
              next_attempt_at, latency_ms, cost_jpy, created_at, updated_at, finished_at
       FROM marketing_generation_jobs
       WHERE id = ?`
    )
    .get(id);

  if (!job) {
    return NextResponse.json({ status: "not_found" }, { status: 404 });
  }

  const content = await db
    .prepare(
      `SELECT id, status, generation_status, generation_error_code, generation_error_message,
              generation_provider, generation_model, generation_prompt,
              media_asset_url, media_thumb_url, media_mime_type,
              generation_latency_ms, generation_cost_jpy
       FROM marketing_contents
       WHERE id = ?`
    )
    .get((job as any).content_id);

  return NextResponse.json({ status: "ok", job, content: content || null });
}
