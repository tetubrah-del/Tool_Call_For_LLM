#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const DEFAULT_BASE_URL = "https://www.moltbook.com/api/v1";
const SAFE_HOSTNAME = "www.moltbook.com";
const DEFAULT_SEARCH_LIMIT = 20;
const DEFAULT_PROFILE_FETCH_LIMIT = 30;
const DEFAULT_TOP_COUNT = 15;

const SINKAI_KEYWORDS = [
  "sinkai",
  "human-in-the-loop",
  "human in the loop",
  "marketplace",
  "task market",
  "bounty"
];

const WORKFLOW_KEYWORDS = [
  "agent",
  "ai agent",
  "tool calling",
  "tool_call",
  "mcp",
  "workflow",
  "automation",
  "orchestrator"
];

const DEFAULT_QUERIES = [
  "sinkai agent marketplace",
  "human in the loop ai agent",
  "tool calling workflow",
  "mcp agent operations"
];

function usage() {
  return `Usage:
  node scripts/moltbook-sinkai-agent.mjs register --name "SinkaiScout" --description "Collects AI agents"
  node scripts/moltbook-sinkai-agent.mjs status
  node scripts/moltbook-sinkai-agent.mjs heartbeat [--feed-limit 15]
  node scripts/moltbook-sinkai-agent.mjs scout [--queries "q1,q2"] [--limit 20] [--out output.json] [--csv output.csv]

Global flags:
  --base-url https://www.moltbook.com/api/v1
  --api-key moltbook_xxx
  --allow-unsafe-base-url (off by default)

register flags:
  --save (optional; save api_key to ~/.config/moltbook/credentials.json)
  --save-path /custom/path/credentials.json

scout flags:
  --type all|posts|comments   (default: all)
  --profile-fetch-limit N     (default: 30)
  --top N                     (default: 15)
`;
}

function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }
    const key = token.slice(2);
    if (!key) continue;
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      flags[key] = true;
      continue;
    }
    flags[key] = next;
    i += 1;
  }
  return {
    command: positional[0] || "help",
    positional: positional.slice(1),
    flags
  };
}

function getFlagString(flags, key, fallback = "") {
  const value = flags[key];
  if (typeof value === "string" && value.trim()) return value.trim();
  return fallback;
}

function getFlagNumber(flags, key, fallback) {
  const raw = flags[key];
  if (raw === undefined || raw === null || raw === true) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

function parseDate(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? new Date(ts) : null;
}

function daysSince(date) {
  if (!date) return Number.POSITIVE_INFINITY;
  const ms = Date.now() - date.getTime();
  return ms / (1000 * 60 * 60 * 24);
}

function countKeywordHits(text, keywords) {
  let hits = 0;
  for (const keyword of keywords) {
    if (text.includes(keyword)) hits += 1;
  }
  return hits;
}

function logScaled(value, maxScore, logDivisor) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  const score = (Math.log10(n + 1) / logDivisor) * maxScore;
  return clamp(score, 0, maxScore);
}

function ensureSafeBaseUrl(baseUrl, allowUnsafe) {
  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error(`Invalid base URL: ${baseUrl}`);
  }
  if (url.protocol !== "https:") {
    throw new Error(`Base URL must use https: ${baseUrl}`);
  }
  if (!allowUnsafe && url.hostname !== SAFE_HOSTNAME) {
    throw new Error(`Unsafe base URL host: ${url.hostname}. Use https://www.moltbook.com/...`);
  }
  return url.toString().replace(/\/$/, "");
}

function getBaseUrl(flags) {
  const raw = getFlagString(flags, "base-url", process.env.MOLTBOOK_BASE_URL || DEFAULT_BASE_URL);
  const allowUnsafe = flags["allow-unsafe-base-url"] === true;
  return ensureSafeBaseUrl(raw, allowUnsafe);
}

function getApiKey(flags) {
  const key = getFlagString(flags, "api-key", process.env.MOLTBOOK_API_KEY || "");
  if (!key) {
    throw new Error("Missing API key. Set MOLTBOOK_API_KEY or pass --api-key.");
  }
  return key;
}

async function apiRequest({ baseUrl, method, endpoint, apiKey, body, query, auth = true }) {
  const url = new URL(`${baseUrl}/${endpoint.replace(/^\/+/, "")}`);
  if (query && typeof query === "object") {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === "") continue;
      url.searchParams.set(k, String(v));
    }
  }

  const headers = {
    "Content-Type": "application/json"
  };
  if (auth) headers.Authorization = `Bearer ${apiKey}`;

  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    const message = typeof data?.error === "string" ? data.error : response.statusText;
    const detail = typeof data?.message === "string" ? ` (${data.message})` : "";
    throw new Error(`${method} ${url.pathname} failed: ${response.status} ${message}${detail}`);
  }
  return data;
}

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function mkdirForFile(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

function serializeCsv(rows, columns) {
  const escapeCell = (value) => {
    if (value === null || value === undefined) return "";
    const raw = String(value);
    if (!raw.includes(",") && !raw.includes('"') && !raw.includes("\n")) return raw;
    return `"${raw.replace(/"/g, '""')}"`;
  };
  const lines = [columns.join(",")];
  for (const row of rows) {
    const line = columns.map((column) => escapeCell(row[column])).join(",");
    lines.push(line);
  }
  return `${lines.join("\n")}\n`;
}

async function commandRegister(flags) {
  const baseUrl = getBaseUrl(flags);
  const name = getFlagString(flags, "name");
  const description = getFlagString(flags, "description");

  if (!name || !description) {
    throw new Error("register requires --name and --description");
  }

  const result = await apiRequest({
    baseUrl,
    method: "POST",
    endpoint: "agents/register",
    auth: false,
    body: { name, description }
  });

  if (flags.save === true) {
    const savePath =
      getFlagString(flags, "save-path") || path.join(os.homedir(), ".config", "moltbook", "credentials.json");
    await mkdirForFile(savePath);
    const payload = {
      api_key: result?.agent?.api_key || "",
      agent_name: name,
      claim_url: result?.agent?.claim_url || "",
      verification_code: result?.agent?.verification_code || "",
      saved_at: new Date().toISOString()
    };
    await fs.writeFile(savePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    await fs.chmod(savePath, 0o600);
    console.log(JSON.stringify({ ...result, saved_credentials_path: savePath }, null, 2));
    return;
  }

  console.log(JSON.stringify(result, null, 2));
}

async function commandStatus(flags) {
  const baseUrl = getBaseUrl(flags);
  const apiKey = getApiKey(flags);
  const status = await apiRequest({
    baseUrl,
    method: "GET",
    endpoint: "agents/status",
    apiKey
  });
  console.log(JSON.stringify(status, null, 2));
}

async function commandHeartbeat(flags) {
  const baseUrl = getBaseUrl(flags);
  const apiKey = getApiKey(flags);
  const feedLimit = getFlagNumber(flags, "feed-limit", 15);

  const [status, dmCheck, feed] = await Promise.allSettled([
    apiRequest({ baseUrl, method: "GET", endpoint: "agents/status", apiKey }),
    apiRequest({ baseUrl, method: "GET", endpoint: "agents/dm/check", apiKey }),
    apiRequest({
      baseUrl,
      method: "GET",
      endpoint: "feed",
      apiKey,
      query: { sort: "new", limit: Math.max(1, Math.floor(feedLimit)) }
    })
  ]);

  const output = {
    checked_at: new Date().toISOString(),
    status: status.status === "fulfilled" ? status.value : { error: String(status.reason) },
    dm_check: dmCheck.status === "fulfilled" ? dmCheck.value : { error: String(dmCheck.reason) },
    feed_preview_count:
      feed.status === "fulfilled"
        ? Array.isArray(feed.value?.posts)
          ? feed.value.posts.length
          : Array.isArray(feed.value)
            ? feed.value.length
            : 0
        : 0,
    feed_error: feed.status === "rejected" ? String(feed.reason) : null
  };

  console.log(JSON.stringify(output, null, 2));
}

function initCandidate(name) {
  return {
    name,
    matches: 0,
    post_count: 0,
    comment_count: 0,
    vote_balance_sum: 0,
    similarity_sum: 0,
    max_similarity: 0,
    sinkai_hits: 0,
    workflow_hits: 0,
    query_hits: new Set(),
    post_ids: new Set(),
    sample_titles: [],
    newest_at: null,
    profile: null
  };
}

function updateNewest(current, nextDate) {
  if (!nextDate) return current;
  if (!current) return nextDate;
  return nextDate > current ? nextDate : current;
}

function recencyScoreFromDate(date) {
  const days = daysSince(date);
  if (days <= 1) return 10;
  if (days <= 7) return 8;
  if (days <= 30) return 5;
  if (days <= 90) return 2;
  return 0;
}

function buildScoredCandidate(candidate, queryCount) {
  const avgSimilarity = candidate.matches > 0 ? candidate.similarity_sum / candidate.matches : 0;
  const avgVoteBalance = candidate.matches > 0 ? candidate.vote_balance_sum / candidate.matches : 0;
  const queryCoverage = queryCount > 0 ? candidate.query_hits.size / queryCount : 0;

  const breakdown = {
    sinkai_relevance: round1(clamp(candidate.sinkai_hits * 4, 0, 20)),
    workflow_relevance: round1(clamp(candidate.workflow_hits * 2, 0, 10)),
    semantic_similarity: round1(clamp(avgSimilarity * 15, 0, 15)),
    query_coverage: round1(clamp(queryCoverage * 10, 0, 10)),
    activity_recency: recencyScoreFromDate(candidate.newest_at),
    vote_quality: round1(clamp(((avgVoteBalance + 2) / 6) * 10, 0, 10)),
    claimed_status: candidate.profile?.is_claimed ? 5 : 0,
    active_status: candidate.profile?.is_active ? 5 : 0,
    karma: round1(logScaled(candidate.profile?.karma || 0, 10, 3)),
    followers: round1(logScaled(candidate.profile?.follower_count || 0, 5, 4))
  };

  const total = round1(Object.values(breakdown).reduce((sum, value) => sum + value, 0));
  const risk_flags = [];
  if (!candidate.profile?.is_claimed) risk_flags.push("unclaimed");
  if (!candidate.profile?.is_active) risk_flags.push("inactive");
  if (avgSimilarity < 0.35) risk_flags.push("low_similarity");
  if (avgVoteBalance < 0) risk_flags.push("negative_vote_balance");
  if (candidate.matches < 2) risk_flags.push("low_sample_count");

  return {
    name: candidate.name,
    score_total: total,
    score_breakdown: breakdown,
    matches: candidate.matches,
    post_count: candidate.post_count,
    comment_count: candidate.comment_count,
    query_hit_count: candidate.query_hits.size,
    query_hits: Array.from(candidate.query_hits),
    avg_similarity: round1(avgSimilarity),
    max_similarity: round1(candidate.max_similarity),
    avg_vote_balance: round1(avgVoteBalance),
    vote_balance_sum: candidate.vote_balance_sum,
    profile: candidate.profile,
    newest_at: candidate.newest_at ? candidate.newest_at.toISOString() : null,
    sample_titles: candidate.sample_titles.slice(0, 5),
    post_ids: Array.from(candidate.post_ids).slice(0, 30),
    risk_flags
  };
}

async function loadProfile(baseUrl, apiKey, name) {
  try {
    const profile = await apiRequest({
      baseUrl,
      method: "GET",
      endpoint: "agents/profile",
      apiKey,
      query: { name }
    });
    return profile?.agent || null;
  } catch {
    return null;
  }
}

async function commandScout(flags) {
  const baseUrl = getBaseUrl(flags);
  const apiKey = getApiKey(flags);

  const rawQueries = getFlagString(flags, "queries");
  const queries = rawQueries
    ? rawQueries
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
    : DEFAULT_QUERIES;

  if (queries.length === 0) throw new Error("At least one query is required.");

  const searchType = getFlagString(flags, "type", "all");
  const limit = Math.max(1, Math.floor(getFlagNumber(flags, "limit", DEFAULT_SEARCH_LIMIT)));
  const topN = Math.max(1, Math.floor(getFlagNumber(flags, "top", DEFAULT_TOP_COUNT)));
  const profileFetchLimit = Math.max(1, Math.floor(getFlagNumber(flags, "profile-fetch-limit", DEFAULT_PROFILE_FETCH_LIMIT)));

  const candidates = new Map();
  const searchLogs = [];

  for (const query of queries) {
    const response = await apiRequest({
      baseUrl,
      method: "GET",
      endpoint: "search",
      apiKey,
      query: { q: query, type: searchType, limit }
    });
    const results = Array.isArray(response?.results) ? response.results : [];
    searchLogs.push({ query, result_count: results.length });

    for (const row of results) {
      const name = row?.author?.name;
      if (!name) continue;
      const candidate = candidates.get(name) || initCandidate(name);
      candidate.matches += 1;

      const itemType = row?.type === "comment" ? "comment" : "post";
      if (itemType === "comment") candidate.comment_count += 1;
      if (itemType === "post") candidate.post_count += 1;

      const similarity = clamp(Number(row?.similarity || 0), 0, 1);
      candidate.similarity_sum += similarity;
      candidate.max_similarity = Math.max(candidate.max_similarity, similarity);

      const upvotes = Number(row?.upvotes || 0);
      const downvotes = Number(row?.downvotes || 0);
      candidate.vote_balance_sum += upvotes - downvotes;

      candidate.query_hits.add(query);
      const postId = row?.post_id || (itemType === "post" ? row?.id : null);
      if (postId) candidate.post_ids.add(postId);

      const combinedText = [
        row?.title,
        row?.content,
        row?.post?.title,
        row?.submolt?.name,
        row?.submolt?.display_name
      ]
        .filter((value) => typeof value === "string" && value.trim())
        .join(" ")
        .toLowerCase();

      candidate.sinkai_hits += countKeywordHits(combinedText, SINKAI_KEYWORDS);
      candidate.workflow_hits += countKeywordHits(combinedText, WORKFLOW_KEYWORDS);

      const createdAt = parseDate(row?.created_at);
      candidate.newest_at = updateNewest(candidate.newest_at, createdAt);
      if (row?.title && candidate.sample_titles.length < 8) {
        candidate.sample_titles.push(String(row.title).slice(0, 140));
      }

      candidates.set(name, candidate);
    }
  }

  const preRanked = Array.from(candidates.values()).sort((a, b) => {
    const aScore = a.similarity_sum + a.matches * 0.2;
    const bScore = b.similarity_sum + b.matches * 0.2;
    return bScore - aScore;
  });

  for (const candidate of preRanked.slice(0, profileFetchLimit)) {
    candidate.profile = await loadProfile(baseUrl, apiKey, candidate.name);
    await new Promise((resolve) => setTimeout(resolve, 120));
  }

  const scored = Array.from(candidates.values())
    .map((candidate) => buildScoredCandidate(candidate, queries.length))
    .sort((a, b) => b.score_total - a.score_total);

  const recommended = scored.filter((item) => {
    return (
      item.score_total >= 70 &&
      item.query_hit_count >= 2 &&
      item.matches >= 2 &&
      item.profile?.is_claimed &&
      item.profile?.is_active
    );
  });

  const outputPath =
    getFlagString(flags, "out") || path.join(process.cwd(), "output", "moltbook", `sinkai-candidates-${nowStamp()}.json`);
  const csvPathFlag = getFlagString(flags, "csv");
  const csvPath =
    csvPathFlag === "true"
      ? outputPath.replace(/\.json$/i, ".csv")
      : csvPathFlag || "";

  const report = {
    generated_at: new Date().toISOString(),
    base_url: baseUrl,
    queries,
    search_type: searchType,
    search_limit: limit,
    search_logs: searchLogs,
    candidate_count: scored.length,
    top_count: topN,
    top_candidates: scored.slice(0, topN),
    recommended_follow_candidates: recommended.slice(0, 10),
    scoring_model: {
      sinkai_relevance: "0-20",
      workflow_relevance: "0-10",
      semantic_similarity: "0-15",
      query_coverage: "0-10",
      activity_recency: "0-10",
      vote_quality: "0-10",
      claimed_status: "0-5",
      active_status: "0-5",
      karma: "0-10",
      followers: "0-5"
    }
  };

  await mkdirForFile(outputPath);
  await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  if (csvPath) {
    const csvRows = scored.map((item) => ({
      name: item.name,
      score_total: item.score_total,
      query_hit_count: item.query_hit_count,
      matches: item.matches,
      avg_similarity: item.avg_similarity,
      vote_balance_sum: item.vote_balance_sum,
      karma: item.profile?.karma ?? "",
      follower_count: item.profile?.follower_count ?? "",
      is_claimed: item.profile?.is_claimed ?? "",
      is_active: item.profile?.is_active ?? "",
      newest_at: item.newest_at ?? "",
      risk_flags: item.risk_flags.join("|")
    }));
    const csv = serializeCsv(csvRows, [
      "name",
      "score_total",
      "query_hit_count",
      "matches",
      "avg_similarity",
      "vote_balance_sum",
      "karma",
      "follower_count",
      "is_claimed",
      "is_active",
      "newest_at",
      "risk_flags"
    ]);
    await mkdirForFile(csvPath);
    await fs.writeFile(csvPath, csv, "utf8");
  }

  const summary = {
    output_path: outputPath,
    csv_path: csvPath || null,
    queries,
    candidate_count: scored.length,
    top_candidates: scored.slice(0, Math.min(topN, 10)).map((item) => ({
      name: item.name,
      score_total: item.score_total,
      query_hit_count: item.query_hit_count,
      matches: item.matches,
      is_claimed: Boolean(item.profile?.is_claimed),
      is_active: Boolean(item.profile?.is_active)
    })),
    recommended_follow_candidates: recommended.slice(0, 5).map((item) => ({
      name: item.name,
      score_total: item.score_total
    }))
  };

  console.log(JSON.stringify(summary, null, 2));
}

async function main() {
  const { command, flags } = parseArgs(process.argv.slice(2));

  if (command === "help" || command === "--help" || command === "-h") {
    console.log(usage());
    return;
  }

  if (command === "register") {
    await commandRegister(flags);
    return;
  }
  if (command === "status") {
    await commandStatus(flags);
    return;
  }
  if (command === "heartbeat") {
    await commandHeartbeat(flags);
    return;
  }
  if (command === "scout") {
    await commandScout(flags);
    return;
  }

  throw new Error(`Unknown command: ${command}\n\n${usage()}`);
}

main().catch((error) => {
  console.error(`[moltbook-sinkai-agent] ${error.message}`);
  process.exitCode = 1;
});
