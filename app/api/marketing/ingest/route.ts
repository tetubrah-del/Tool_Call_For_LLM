import crypto from "crypto";
import { ApiClient, DefaultApi, GetItemsRequestContent } from "@amzn/creatorsapi-nodejs-sdk";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireMarketingApiKey } from "@/lib/marketing-api-auth";

const CREATORS_CREDENTIAL_ID = (
  process.env.CREATORS_API_CREDENTIAL_ID ||
  process.env.AMAZON_CREATORS_CREDENTIAL_ID ||
  process.env.AMAZON_PAAPI_ACCESS_KEY ||
  ""
).trim();
const CREATORS_CREDENTIAL_SECRET = (
  process.env.CREATORS_API_CREDENTIAL_SECRET ||
  process.env.AMAZON_CREATORS_CREDENTIAL_SECRET ||
  process.env.AMAZON_PAAPI_SECRET_KEY ||
  ""
).trim();
const CREATORS_CREDENTIAL_VERSION = (
  process.env.CREATORS_API_CREDENTIAL_VERSION ||
  process.env.AMAZON_CREATORS_CREDENTIAL_VERSION ||
  process.env.AMAZON_PAAPI_VERSION ||
  ""
).trim();
const CREATORS_MARKETPLACE = (
  process.env.CREATORS_API_MARKETPLACE ||
  process.env.AMAZON_CREATORS_MARKETPLACE ||
  process.env.AMAZON_PAAPI_MARKETPLACE ||
  "www.amazon.co.jp"
).trim();
const CREATORS_PARTNER_TAG = (
  process.env.CREATORS_API_PARTNER_TAG ||
  process.env.AMAZON_CREATORS_PARTNER_TAG ||
  process.env.AMAZON_PAAPI_PARTNER_TAG ||
  ""
).trim();
const CREATORS_BASE_URL = (
  process.env.CREATORS_API_BASE_URL ||
  process.env.AMAZON_CREATORS_BASE_URL ||
  ""
).trim();
const CREATORS_AUTH_ENDPOINT = (
  process.env.CREATORS_API_AUTH_ENDPOINT ||
  process.env.AMAZON_CREATORS_AUTH_ENDPOINT ||
  ""
).trim();
const MARKETING_ALERT_EMAIL = (process.env.MARKETING_ALERT_EMAIL || "tetubrah@gmail.com").trim();

function normalizeText(value: unknown, max = 10000) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function normalizeIsoDateTime(value: unknown) {
  const s = normalizeText(value, 100);
  if (!s) return "";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString();
}

function safeJsonStringify(value: unknown): string | null {
  if (value == null) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function extractAsin(productUrl: string) {
  let parsed: URL;
  try {
    parsed = new URL(productUrl);
  } catch {
    return null;
  }
  const host = parsed.host.toLowerCase();
  if (!(host === "amazon.co.jp" || host.endsWith(".amazon.co.jp"))) return null;

  const pathname = parsed.pathname || "";
  const direct = pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?]|$)/i);
  if (direct?.[1]) return direct[1].toUpperCase();

  const fallback = productUrl.match(/([A-Z0-9]{10})/i);
  if (!fallback?.[1]) return null;
  return fallback[1].toUpperCase();
}

function normalizeProductUrl(productUrl: string) {
  const parsed = new URL(productUrl);
  parsed.hash = "";
  parsed.search = "";
  return parsed.toString();
}

function findFirstString(values: unknown[]) {
  for (const v of values) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function findFirstNumber(values: unknown[]) {
  for (const v of values) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function toHashtagWord(value: string) {
  return value
    .replace(/[#＃]/g, "")
    .replace(/[^\p{L}\p{N}_]/gu, "")
    .slice(0, 20);
}

function buildHashtags(brand: string, title: string) {
  const brandTag = toHashtagWord(brand);
  const smartBrandTag = brandTag ? `#${brandTag}` : "#Amazonおすすめ";
  const hints = /掃除|クリーナー|洗車|clean|vacuum/i.test(title) ? "#時短家事" : "#買ってよかった";
  return [smartBrandTag, "#Amazonおすすめ", hints].slice(0, 3);
}

function isMedicalContent(title: string, features: string[]) {
  const medicalKeywords = [
    /医療/i,
    /治療/i,
    /診断/i,
    /病気/i,
    /薬/i,
    /サプリ/i,
    /healthcare/i,
    /medical/i,
    /medicine/i,
    /supplement/i
  ];
  const haystack = `${title}\n${features.join("\n")}`;
  return medicalKeywords.some((re) => re.test(haystack));
}

function buildMarketingText(params: {
  title: string;
  brand: string;
  features: string[];
  priceText: string;
  productUrl: string;
}) {
  const f1 = params.features[0] || "使いやすさがしっかり考えられていて";
  const f2 = params.features[1] || "日常での出番が多い";
  const lead = params.brand
    ? `${params.brand}のこれ、正直かなり当たりでした✨`
    : "これ、正直かなり当たりでした✨";
  return [
    lead,
    `${f1}。${f2}。`,
    params.priceText ? `価格感: ${params.priceText}` : "",
    "迷ってるなら一度チェックしてみてください👇",
    params.productUrl
  ]
    .filter(Boolean)
    .join("\n");
}

function buildSeedancePrompt(params: {
  title: string;
  brand: string;
  features: string[];
  priceText: string;
}) {
  const featureLines = params.features.slice(0, 3).map((v) => `- ${v}`);
  return [
    "15-second vertical UGC style video (9:16), smartphone aesthetic, Japanese creator tone.",
    "Scene plan:",
    "1) Hook (0-3s): close-up product reveal with energetic hand motion.",
    "2) Demo (3-10s): show practical use in real home setting with quick cuts.",
    "3) CTA (10-15s): creator points to product and smiles; overlay subtle CTA text.",
    `Product: ${params.title}`,
    params.brand ? `Brand: ${params.brand}` : "",
    params.priceText ? `Price context: ${params.priceText}` : "",
    featureLines.length ? `Key points:\n${featureLines.join("\n")}` : "",
    "No medical claims. No before/after treatment framing. No exaggerated guarantee."
  ]
    .filter(Boolean)
    .join("\n");
}

function buildSeedanceNegativePrompt() {
  return [
    "medical, medicine, supplement, diagnosis, treatment",
    "before-after cure claims, guaranteed results, fake review UI",
    "low quality, watermark, blurry, distorted hands, overexposed"
  ].join(", ");
}

async function queueAlertEmail(
  db: ReturnType<typeof getDb>,
  subject: string,
  bodyText: string
) {
  if (!MARKETING_ALERT_EMAIL) return;
  const createdAt = nowIso();
  await db
    .prepare(
      `INSERT INTO email_deliveries
       (id, event_id, to_email, template_key, subject, body_text, status, attempt_count, next_attempt_at, provider_message_id, last_error, created_at, updated_at, sent_at)
       VALUES (?, NULL, ?, 'marketing_alert', ?, ?, 'queued', 0, ?, NULL, NULL, ?, ?, NULL)`
    )
    .run(crypto.randomUUID(), MARKETING_ALERT_EMAIL, subject, bodyText, createdAt, createdAt, createdAt);
}

async function fetchAmazonItem(asin: string) {
  if (
    !CREATORS_CREDENTIAL_ID ||
    !CREATORS_CREDENTIAL_SECRET ||
    !CREATORS_CREDENTIAL_VERSION ||
    !CREATORS_PARTNER_TAG
  ) {
    throw new Error("creators_api_not_configured");
  }

  const apiClient = CREATORS_BASE_URL ? new ApiClient(CREATORS_BASE_URL) : new ApiClient();
  apiClient.credentialId = CREATORS_CREDENTIAL_ID;
  apiClient.credentialSecret = CREATORS_CREDENTIAL_SECRET;
  apiClient.version = CREATORS_CREDENTIAL_VERSION;
  if (CREATORS_AUTH_ENDPOINT) {
    apiClient.authEndpoint = CREATORS_AUTH_ENDPOINT;
  }
  const api = new DefaultApi(apiClient);

  const request = new GetItemsRequestContent();
  request.partnerTag = CREATORS_PARTNER_TAG;
  request.itemIds = [asin];
  request.condition = "New";
  request.resources = [
    "images.primary.large",
    "images.variants.large",
    "itemInfo.title",
    "itemInfo.features",
    "itemInfo.byLineInfo",
    "offersV2.listings.price",
    "customerReviews.starRating",
    "customerReviews.count"
  ];

  let response: any;
  try {
    response = await api.getItems(CREATORS_MARKETPLACE, request);
  } catch (error: any) {
    const reason = findFirstString([
      error?.response?.body?.errors?.[0]?.code,
      error?.response?.body?.errors?.[0]?.message,
      error?.message,
      "creators_api_request_failed"
    ]);
    throw new Error(reason || "creators_api_request_failed");
  }

  if (Array.isArray(response?.errors) && response.errors.length > 0) {
    const reason = findFirstString([
      response.errors?.[0]?.code,
      response.errors?.[0]?.message,
      "creators_api_partial_error"
    ]);
    throw new Error(reason || "creators_api_partial_error");
  }

  const item = response?.itemsResult?.items?.[0];
  if (!item) {
    const errorCode = findFirstString([response?.errors?.[0]?.code, "creators_api_item_not_found"]);
    throw new Error(errorCode);
  }

  const title = findFirstString([item?.itemInfo?.title?.displayValue]);
  const features: string[] = Array.isArray(item?.itemInfo?.features?.displayValues)
    ? item.itemInfo.features.displayValues.filter((v: unknown) => typeof v === "string").map((v: string) => v.trim())
    : [];
  const brand = findFirstString([
    item?.itemInfo?.byLineInfo?.brand?.displayValue,
    item?.itemInfo?.byLineInfo?.manufacturer?.displayValue,
    item?.itemInfo?.byLineInfo?.contributors?.[0]?.displayName
  ]);
  const priceText = findFirstString([
    item?.offersV2?.listings?.[0]?.price?.displayAmount,
    item?.offersV2?.listings?.[0]?.price?.amount
  ]);
  const imageUrls = [
    findFirstString([item?.images?.primary?.large?.url]),
    ...(Array.isArray(item?.images?.variants)
      ? item.images.variants.map((v: any) => findFirstString([v?.large?.url])).filter(Boolean)
      : [])
  ].filter(Boolean);
  const rating = findFirstNumber([item?.customerReviews?.starRating?.value]);
  const reviewCount = findFirstNumber([item?.customerReviews?.count]);

  if (!title) {
    throw new Error("paapi_missing_title");
  }

  return {
    asin,
    title,
    features: features.slice(0, 8),
    brand,
    price_text: priceText ? String(priceText) : "",
    image_urls: imageUrls.slice(0, 8),
    rating,
    review_count: reviewCount,
    raw: response
  };
}

export async function POST(request: Request) {
  const authError = requireMarketingApiKey(request);
  if (authError) return authError;

  const payload: any = await request.json().catch(() => ({}));
  const rawUrl = normalizeText(payload?.product_url, 2000);
  const aiAccountId = normalizeText(payload?.ai_account_id, 120) || "manual";
  const channel = normalizeText(payload?.channel, 20).toLowerCase() === "x" ? "x" : "x";
  const scheduledAt = normalizeIsoDateTime(payload?.scheduled_at);
  const seedanceModel = normalizeText(process.env.SEEDANCE_MODEL, 200);

  if (!rawUrl) {
    return NextResponse.json({ status: "error", reason: "invalid_request" }, { status: 400 });
  }
  if (!seedanceModel) {
    return NextResponse.json({ status: "error", reason: "missing_model_config" }, { status: 400 });
  }

  const asin = extractAsin(rawUrl);
  if (!asin) {
    return NextResponse.json({ status: "error", reason: "invalid_amazon_jp_url" }, { status: 400 });
  }

  const productUrl = normalizeProductUrl(rawUrl);
  const db = getDb();
  const duplicate = await db
    .prepare(
      `SELECT id, status, created_at
       FROM marketing_contents
       WHERE product_url = ?
         AND created_at >= ?
         AND status <> 'failed'
       ORDER BY created_at DESC
       LIMIT 1`
    )
    .get(productUrl, new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
  if (duplicate) {
    return NextResponse.json(
      { status: "error", reason: "duplicate_product_within_24h", content_id: (duplicate as any).id },
      { status: 409 }
    );
  }

  let product: any;
  try {
    product = await fetchAmazonItem(asin);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "ingest_failed";
    await queueAlertEmail(
      db,
      `[Marketing][Ingest Failed] ASIN:${asin}`,
      [`reason=${reason}`, `url=${productUrl}`, `at=${nowIso()}`].join("\n")
    );
    return NextResponse.json({ status: "error", reason: "extract_failed", detail: reason }, { status: 422 });
  }

  if (isMedicalContent(product.title, product.features || [])) {
    await queueAlertEmail(
      db,
      `[Marketing][Ingest Blocked:Medical] ASIN:${asin}`,
      [`url=${productUrl}`, `title=${product.title}`, `at=${nowIso()}`].join("\n")
    );
    return NextResponse.json({ status: "error", reason: "unsupported_medical_category" }, { status: 400 });
  }

  const hashtags = buildHashtags(product.brand || "", product.title || "");
  const bodyText = buildMarketingText({
    title: product.title,
    brand: product.brand || "",
    features: product.features || [],
    priceText: product.price_text || "",
    productUrl
  });
  const prompt = buildSeedancePrompt({
    title: product.title,
    brand: product.brand || "",
    features: product.features || [],
    priceText: product.price_text || ""
  });
  const promptNegative = buildSeedanceNegativePrompt();

  const now = nowIso();
  const contentId = crypto.randomUUID();
  const generationJobId = crypto.randomUUID();

  await db
    .prepare(
      `INSERT INTO marketing_contents (
         id, brief_id, channel, format, title, body_text, asset_manifest_json,
         hashtags_json, metadata_json, version, status, generation_provider,
         generation_model, generation_prompt, generation_seed, generation_status,
         generation_error_code, generation_error_message, product_url, source_context_json,
         created_at, updated_at
       ) VALUES (?, 'manual', ?, 'video', ?, ?, NULL, ?, ?, 1, 'approved', 'seedance',
                 ?, ?, NULL, 'queued', NULL, NULL, ?, ?, ?, ?)`
    )
    .run(
      contentId,
      channel,
      normalizeText(product.title, 300),
      normalizeText(bodyText, 5000),
      JSON.stringify(hashtags),
      JSON.stringify({
        source: "amazon_creators_api",
        asin,
        auto_publish: true,
        duration_sec: 15,
        aspect_ratio: "9:16",
        alert_email: MARKETING_ALERT_EMAIL
      }),
      seedanceModel,
      normalizeText(prompt, 5000),
      productUrl,
      safeJsonStringify(product),
      now,
      now
    );

  await db
    .prepare(
      `INSERT INTO marketing_generation_jobs (
         id, content_id, asset_type, provider, model, status, prompt, prompt_negative,
         seed, request_json, response_json, error_code, error_message, retryable, attempt_count,
         next_attempt_at, latency_ms, cost_jpy, created_at, updated_at, finished_at
       ) VALUES (?, ?, 'video', 'seedance', ?, 'queued', ?, ?, NULL, ?, NULL, NULL, NULL, 0, 0, NULL, NULL, NULL, ?, ?, NULL)`
    )
    .run(
      generationJobId,
      contentId,
      seedanceModel,
      normalizeText(prompt, 5000),
      normalizeText(promptNegative, 2000),
      JSON.stringify({
        request: {
          ratio: "9:16",
          duration: 15,
          resolution: "720p",
          content: [{ type: "text", text: normalizeText(prompt, 5000) }],
          negative_prompt: normalizeText(promptNegative, 2000)
        },
        source: {
          kind: "amazon_creators_api",
          asin,
          ai_account_id: aiAccountId
        }
      }),
      now,
      now
    );

  if (scheduledAt) {
    await db
      .prepare(
        `UPDATE marketing_contents
         SET metadata_json = ?
         WHERE id = ?`
      )
      .run(
        JSON.stringify({
          source: "amazon_creators_api",
          asin,
          auto_publish: true,
          scheduled_at: scheduledAt,
          duration_sec: 15,
          aspect_ratio: "9:16",
          alert_email: MARKETING_ALERT_EMAIL
        }),
        contentId
      );
  }

  return NextResponse.json(
    {
      status: "queued",
      content_id: contentId,
      generation_job_id: generationJobId,
      product: {
        asin,
        title: product.title,
        brand: product.brand || null,
        price_text: product.price_text || null
      },
      config: {
        duration_sec: 15,
        aspect_ratio: "9:16",
        channel: "x",
        auto_publish: true
      }
    },
    { status: 201 }
  );
}
