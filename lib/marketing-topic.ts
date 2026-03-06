export function normalizeText(value: unknown, max = 10000) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

export function normalizeIsoDateTime(value: unknown) {
  const s = normalizeText(value, 100);
  if (!s) return "";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString();
}

export function safeJsonParse(raw: unknown, fallback: any = null) {
  if (typeof raw !== "string") return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function normalizeSourceContext(payload: any) {
  const rawObject =
    payload?.source_context && typeof payload.source_context === "object" && !Array.isArray(payload.source_context)
      ? payload.source_context
      : safeJsonParse(payload?.source_context_json, {});
  const source: Record<string, unknown> = rawObject && typeof rawObject === "object" ? { ...rawObject } : {};

  const sourceType = normalizeText(payload?.source_type, 40).toLowerCase();
  const sourceUrl = normalizeText(payload?.source_url, 2000);
  const sourcePostId = normalizeText(payload?.source_post_id, 120);
  const sourceTitle = normalizeText(payload?.source_title, 300);
  const sourcePublisher = normalizeText(payload?.source_publisher, 120);
  const sourceDomain = normalizeText(payload?.source_domain, 120);
  const sourcePublishedAt = normalizeIsoDateTime(payload?.source_published_at);

  if (sourceType) source.source_type = sourceType;
  if (sourceUrl) source.source_url = sourceUrl;
  if (sourcePostId) source.source_post_id = sourcePostId;
  if (sourceTitle) source.source_title = sourceTitle;
  if (sourcePublisher) source.source_publisher = sourcePublisher;
  if (sourceDomain) source.source_domain = sourceDomain;
  if (sourcePublishedAt) source.source_published_at = sourcePublishedAt;

  const keys = Object.keys(source).filter((key) => source[key] !== null && source[key] !== undefined && source[key] !== "");
  if (!keys.length) return null;
  const normalized: Record<string, unknown> = {};
  for (const key of keys) {
    normalized[key] = source[key];
  }
  return normalized;
}

const TRACKING_QUERY_PARAMS = new Set([
  "fbclid",
  "gclid",
  "igshid",
  "mc_cid",
  "mc_eid",
  "ref",
  "s",
  "si",
  "source",
  "src",
  "twclid",
  "utm_campaign",
  "utm_content",
  "utm_id",
  "utm_medium",
  "utm_source",
  "utm_term"
]);

function collapseWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function pickLeadSentence(bodyText: string) {
  const normalized = collapseWhitespace(bodyText);
  if (!normalized) return "";
  const match = normalized.match(/^(.{1,220}?)(?:[。.!?\n]|$)/);
  return normalizeText(match?.[1] || normalized, 220);
}

export function canonicalizeUrl(value: unknown) {
  const raw = normalizeText(value, 2000);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    url.hash = "";
    const kept = new URLSearchParams();
    Array.from(url.searchParams.keys())
      .sort()
      .forEach((key) => {
        if (!TRACKING_QUERY_PARAMS.has(key.toLowerCase())) {
          for (const entry of url.searchParams.getAll(key)) {
            kept.append(key, entry);
          }
        }
      });
    url.search = kept.toString() ? `?${kept.toString()}` : "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return raw.replace(/#.*$/, "");
  }
}

export function normalizeTopicText(value: unknown, max = 180) {
  const base = normalizeText(value, max * 4).toLowerCase();
  if (!base) return "";
  return base
    .normalize("NFKC")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[「」『』（）()［］\[\]{}【】<>〈〉《》"'`´’‘、,，。.!！?？:：;；/\\|+*=~^%$#@&\-–—_]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function deriveTopicFields(input: {
  title?: unknown;
  bodyText?: unknown;
  productUrl?: unknown;
  sourceContext?: Record<string, unknown> | null;
}) {
  const sourceContext = input.sourceContext && typeof input.sourceContext === "object" ? input.sourceContext : null;
  const sourceTitle = normalizeText(sourceContext?.source_title, 300);
  const sourceDomain = normalizeText(sourceContext?.source_domain, 160).toLowerCase();
  const sourcePostId = normalizeText(sourceContext?.source_post_id, 120).toLowerCase();
  const sourceUrl = canonicalizeUrl(sourceContext?.source_url);
  const productUrl = canonicalizeUrl(input.productUrl);
  const title = normalizeText(input.title, 300);
  const bodyText = normalizeText(input.bodyText, 5000);

  const topicSummary =
    sourceTitle ||
    title ||
    pickLeadSentence(bodyText) ||
    normalizeText(sourceUrl || productUrl, 240) ||
    "";

  const normalizedSourceTitle = normalizeTopicText(sourceTitle);
  const normalizedTitle = normalizeTopicText(title);
  const normalizedLead = normalizeTopicText(pickLeadSentence(bodyText), 120);
  const normalizedSourceUrl = normalizeTopicText(sourceUrl, 220);
  const normalizedProductUrl = normalizeTopicText(productUrl, 160);

  const keyParts = [
    sourceDomain,
    sourcePostId ? `post ${sourcePostId}` : "",
    normalizedSourceTitle,
    normalizedTitle,
    normalizedLead,
    !normalizedSourceTitle && !normalizedTitle && normalizedSourceUrl ? normalizedSourceUrl : "",
    !normalizedSourceTitle && !normalizedTitle && !normalizedSourceUrl && normalizedProductUrl ? normalizedProductUrl : ""
  ].filter(Boolean);

  const topicKey = keyParts.length ? keyParts.join(" | ").slice(0, 500) : "";

  return {
    topicKey: topicKey || null,
    topicSummary: topicSummary || null,
    canonicalSourceUrl: sourceUrl || null,
    sourceDomain: sourceDomain || null,
    sourcePostId: sourcePostId || null,
    normalizedTitle: normalizedSourceTitle || normalizedTitle || normalizedLead || ""
  };
}

export function parseSourceContext(raw: unknown) {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  return safeJsonParse(raw, null);
}

function isEquivalentTitle(a: string, b: string) {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length >= 24 && (a.includes(b) || b.includes(a))) return true;
  return false;
}

export async function findRecentTopicDuplicate(
  db: any,
  input: {
    contentId: string;
    channel: string;
    topicKey?: string | null;
    topicSummary?: string | null;
    title?: string | null;
    bodyText?: string | null;
    productUrl?: string | null;
    sourceContext?: Record<string, unknown> | null;
    publishedLookbackDays?: number;
    queuedLookbackDays?: number;
  }
) {
  const publishedLookbackDays = Math.max(1, Math.min(30, Math.trunc(input.publishedLookbackDays ?? 7)));
  const queuedLookbackDays = Math.max(1, Math.min(14, Math.trunc(input.queuedLookbackDays ?? 3)));
  const now = Date.now();
  const publishedSince = new Date(now - publishedLookbackDays * 24 * 60 * 60 * 1000).toISOString();
  const queuedSince = new Date(now - queuedLookbackDays * 24 * 60 * 60 * 1000).toISOString();

  const rows = await db
    .prepare(
      `SELECT c.id, c.title, c.body_text, c.product_url, c.topic_key, c.topic_summary, c.source_context_json,
              c.updated_at,
              p.id AS post_id, p.post_url, p.published_at,
              j.id AS publish_job_id, j.status AS publish_job_status, j.created_at AS publish_job_created_at
       FROM marketing_contents c
       LEFT JOIN marketing_posts p
         ON p.content_id = c.id
        AND p.channel = ?
       LEFT JOIN marketing_publish_jobs j
         ON j.content_id = c.id
        AND j.channel = ?
        AND j.status IN ('queued', 'processing', 'retry')
       WHERE c.channel = ?
         AND c.id <> ?
         AND (
           (p.published_at IS NOT NULL AND p.published_at >= ?)
           OR (j.created_at IS NOT NULL AND j.created_at >= ?)
         )
       ORDER BY COALESCE(p.published_at, j.created_at, c.updated_at) DESC
       LIMIT 100`
    )
    .all(input.channel, input.channel, input.channel, input.contentId, publishedSince, queuedSince);

  const target = deriveTopicFields({
    title: input.title,
    bodyText: input.bodyText,
    productUrl: input.productUrl,
    sourceContext: input.sourceContext
  });
  const explicitTopicKey = normalizeText(input.topicKey, 500) || target.topicKey || "";

  for (const row of rows) {
    const candidateSourceContext = parseSourceContext(row.source_context_json);
    const candidate = deriveTopicFields({
      title: row.title,
      bodyText: row.body_text,
      productUrl: row.product_url,
      sourceContext: candidateSourceContext
    });
    const candidateTopicKey = normalizeText(row.topic_key, 500) || candidate.topicKey || "";
    const candidateTopicSummary = normalizeText(row.topic_summary, 240) || candidate.topicSummary || "";

    let reason = "";
    if (target.sourcePostId && candidate.sourcePostId && target.sourcePostId === candidate.sourcePostId) {
      const sameDomain = target.sourceDomain && candidate.sourceDomain && target.sourceDomain === candidate.sourceDomain;
      if (sameDomain || !target.sourceDomain || !candidate.sourceDomain) {
        reason = "same_source_post";
      }
    }
    if (!reason && target.canonicalSourceUrl && candidate.canonicalSourceUrl && target.canonicalSourceUrl === candidate.canonicalSourceUrl) {
      reason = "same_source_url";
    }
    if (!reason && explicitTopicKey && candidateTopicKey && explicitTopicKey === candidateTopicKey) {
      reason = "same_topic_key";
    }
    if (
      !reason &&
      target.normalizedTitle &&
      candidate.normalizedTitle &&
      isEquivalentTitle(target.normalizedTitle, candidate.normalizedTitle)
    ) {
      reason = "same_topic_title";
    }

    if (reason) {
      return {
        reason,
        duplicate: {
          content_id: row.id,
          title: row.title || candidateTopicSummary || null,
          topic_key: candidateTopicKey || null,
          topic_summary: candidateTopicSummary || null,
          post_id: row.post_id || null,
          post_url: row.post_url || null,
          published_at: row.published_at || null,
          publish_job_id: row.publish_job_id || null,
          publish_job_status: row.publish_job_status || null,
          queued_at: row.publish_job_created_at || null
        }
      };
    }
  }

  return null;
}
