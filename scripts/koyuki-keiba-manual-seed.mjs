import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const API_BASE_URL = (
  process.env.KOYUKI_KEIBA_API_BASE_URL ||
  process.env.INTERNAL_API_BASE_URL ||
  process.env.APP_BASE_URL ||
  "http://127.0.0.1:3000"
)
  .trim()
  .replace(/\/$/, "");
const MARKETING_API_KEY = (process.env.MARKETING_API_KEY || "").trim();
const DEFAULT_CAMPAIGN_ID = (process.env.APP_CAMPAIGN_ID || "koyuki_keiba_v2").trim();
const DEFAULT_PERSONA_ID = (process.env.APP_PERSONA_ID || "koyuki_keiba_v2").trim();
const ALLOWED_CONTENT_TYPES = new Set([
  "race_prediction",
  "race_review",
  "famous_horse_story",
  "history_trivia"
]);

function usage() {
  console.error(
    [
      "usage: node scripts/koyuki-keiba-manual-seed.mjs <drafts.json> [--dry-run] [--skip-existing]",
      "",
      "drafts.json format:",
      '{ "drafts": [ { "slot_key": "0730", "planned_for": "2026-03-12", "content_type": "history_trivia", "body_text": "..." } ] }'
    ].join("\n")
  );
}

function normalizeText(value, max = 5000) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function normalizeHashtags(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => normalizeText(item, 30))
    .filter(Boolean)
    .map((item) => (item.startsWith("#") ? item : `#${item}`))
    .slice(0, 6);
}

function normalizeDraft(raw, index) {
  const slotKey = normalizeText(raw?.slot_key, 4);
  const plannedFor = normalizeText(raw?.planned_for, 10);
  const contentType = normalizeText(raw?.content_type, 80);
  const title = normalizeText(raw?.title, 300) || null;
  const bodyText = normalizeText(raw?.body_text ?? raw?.body, 5000);
  const sourceUrl = normalizeText(raw?.source_url, 2000);
  const sourceDomain = normalizeText(raw?.source_domain, 255).toLowerCase();

  const errors = [];
  if (!/^\d{4}$/.test(slotKey)) errors.push("slot_key must be HHMM");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(plannedFor)) errors.push("planned_for must be YYYY-MM-DD");
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) errors.push("content_type is not allowed");
  if (!bodyText) errors.push("body_text is required");
  if (!sourceUrl) errors.push("source_url is required");
  if (!sourceDomain) errors.push("source_domain is required");

  return {
    index,
    errors,
    key: `${plannedFor}:${slotKey}`,
    payload: {
      brief_id: normalizeText(raw?.brief_id, 120) || "koyuki-keiba-codex-manual",
      channel: "x",
      format: "text",
      campaign_id: normalizeText(raw?.campaign_id, 120) || DEFAULT_CAMPAIGN_ID,
      persona_id: normalizeText(raw?.persona_id, 120) || DEFAULT_PERSONA_ID,
      content_type: contentType,
      slot_key: slotKey,
      planned_for: plannedFor,
      title,
      body_text: bodyText,
      hashtags: normalizeHashtags(raw?.hashtags),
      source_url: sourceUrl,
      source_domain: sourceDomain,
      metadata: {
        planned_by: "codex_manual_seed",
        source_kind: normalizeText(raw?.source_kind, 80) || "manual_fact_grounded",
        notes: normalizeText(raw?.notes, 500) || null
      }
    }
  };
}

async function loadDrafts(filePath) {
  const absolutePath = path.resolve(process.cwd(), filePath);
  const raw = await fs.readFile(absolutePath, "utf8");
  const parsed = JSON.parse(raw);
  const drafts = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.drafts) ? parsed.drafts : null;
  if (!drafts?.length) {
    throw new Error("drafts file does not contain a drafts array");
  }
  return drafts.map(normalizeDraft);
}

async function fetchExistingContents(limit) {
  const response = await fetch(`${API_BASE_URL}/api/marketing/contents?limit=${limit}`, {
    headers: {
      "x-marketing-api-key": MARKETING_API_KEY
    },
    signal: AbortSignal.timeout(15000)
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`failed to list existing contents: http ${response.status} ${text}`);
  }
  const parsed = JSON.parse(text);
  return Array.isArray(parsed?.contents) ? parsed.contents : [];
}

async function createContent(payload) {
  const response = await fetch(`${API_BASE_URL}/api/marketing/contents`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-marketing-api-key": MARKETING_API_KEY
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000)
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`http ${response.status} ${text}`);
  }
  return JSON.parse(text);
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const skipExisting = args.includes("--skip-existing");
  const filePath = args.find((arg) => !arg.startsWith("--"));

  if (!MARKETING_API_KEY) {
    console.error("manual seed failed: MARKETING_API_KEY is not configured");
    process.exitCode = 1;
    return;
  }
  if (!filePath) {
    usage();
    process.exitCode = 1;
    return;
  }

  const drafts = await loadDrafts(filePath);
  const validationErrors = drafts.filter((draft) => draft.errors.length);
  if (validationErrors.length) {
    for (const draft of validationErrors) {
      console.error(`draft[${draft.index}] invalid: ${draft.errors.join(", ")}`);
    }
    process.exitCode = 1;
    return;
  }

  const duplicateInputs = new Set();
  for (const draft of drafts) {
    if (duplicateInputs.has(draft.key)) {
      console.error(`manual seed failed: duplicate key in input ${draft.key}`);
      process.exitCode = 1;
      return;
    }
    duplicateInputs.add(draft.key);
  }

  const existingContents = await fetchExistingContents(Math.max(100, drafts.length * 20));
  const existingKeys = new Set(
    existingContents
      .filter(
        (row) =>
          normalizeText(row?.campaign_id, 120) === DEFAULT_CAMPAIGN_ID &&
          normalizeText(row?.persona_id, 120) === DEFAULT_PERSONA_ID
      )
      .map((row) => `${normalizeText(row?.planned_for, 10)}:${normalizeText(row?.slot_key, 4)}`)
  );

  const collisions = drafts.filter((draft) => existingKeys.has(draft.key));
  if (collisions.length && !skipExisting) {
    for (const draft of collisions) {
      console.error(`manual seed blocked: existing content found for ${draft.key}`);
    }
    console.error("re-run with --skip-existing after verifying the existing drafts are the ones you want to keep");
    process.exitCode = 1;
    return;
  }

  const created = [];
  const skipped = [];
  for (const draft of drafts) {
    if (existingKeys.has(draft.key)) {
      skipped.push(draft.key);
      continue;
    }
    if (dryRun) {
      created.push({ key: draft.key, dry_run: true, title: draft.payload.title });
      continue;
    }
    const result = await createContent(draft.payload);
    created.push({
      key: draft.key,
      id: result?.content?.id || null,
      title: result?.content?.title || draft.payload.title
    });
  }

  console.log(
    JSON.stringify(
      {
        status: dryRun ? "dry_run_ok" : "ok",
        api_base_url: API_BASE_URL,
        created_count: created.length,
        skipped_count: skipped.length,
        created,
        skipped
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error("manual seed failed", error);
  process.exitCode = 1;
});
