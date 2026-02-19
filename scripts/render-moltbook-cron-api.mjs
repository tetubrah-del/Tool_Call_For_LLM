#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execSync } from "node:child_process";

const RENDER_API_BASE = "https://api.render.com/v1";
const DEFAULT_REGION = "virginia";
const DEFAULT_PLAN = "starter";
const DEFAULT_BRANCH = "main";
const DEFAULT_BUILD_COMMAND = "npm install";
const DEFAULT_MOLTBOOK_BASE_URL = "https://www.moltbook.com/api/v1";
const DEFAULT_API_RETRY_MAX = 8;

const MANAGED_JOBS = [
  {
    name: "sinkai-engagement-cycle",
    schedule: "*/10 * * * *",
    startCommand: "node scripts/moltbook-engagement-worker.mjs autopost-second"
  },
  {
    name: "sinkai-heartbeat",
    schedule: "*/30 * * * *",
    startCommand: "node scripts/moltbook-sinkai-agent.mjs heartbeat --feed-limit 15"
  },
  {
    name: "sinkai-scout-3h",
    schedule: "15 */3 * * *",
    startCommand:
      "node scripts/moltbook-sinkai-agent.mjs scout --limit 20 --top 15 --min-similarity 0.35 --min-matches 2 --auto-follow --auto-follow-max 1 --auto-follow-min-score 70 --csv output/moltbook/sinkai-candidates-latest.csv --out output/moltbook/sinkai-candidates-latest.json"
  },
  {
    name: "sinkai-scout-daily",
    schedule: "10 0 * * *",
    startCommand:
      "node scripts/moltbook-sinkai-agent.mjs scout --limit 20 --top 20 --min-similarity 0.35 --min-matches 2 --csv true"
  }
];

function usage() {
  return `Usage:
  node scripts/render-moltbook-cron-api.mjs plan [flags]
  node scripts/render-moltbook-cron-api.mjs apply [flags]

Flags:
  --env-file .env.local
  --owner-id tea_xxx                  (optional; auto-detected if omitted)
  --repo https://github.com/org/repo  (optional; auto-detected from git remote)
  --branch main
  --region virginia
  --plan starter
  --build-command "npm install"
  --auto-deploy yes|no                (default: no)
  --jobs sinkai-heartbeat,sinkai-scout-3h
  --replace-changed                   (apply only: delete + recreate drifted jobs)

Environment:
  RENDER_API_KEY                      (required)
  MOLTBOOK_API_KEY                    (required for apply)
  MOLTBOOK_BASE_URL                   (default: https://www.moltbook.com/api/v1)
  MOLTBOOK_WATCH_POST_IDS             (optional)
`;
}

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      flags[key] = true;
      continue;
    }
    flags[key] = next;
    i += 1;
  }
  return {
    command: positional[0] || "plan",
    flags
  };
}

function getFlagString(flags, key, fallback = "") {
  const value = flags[key];
  if (typeof value === "string" && value.trim()) return value.trim();
  return fallback;
}

function parseEnvFile(filePath) {
  const fullPath = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(fullPath)) return {};
  const lines = fs.readFileSync(fullPath, "utf8").split(/\r?\n/);
  const out = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function applyEnvFileIfProvided(flags) {
  const envFile = getFlagString(flags, "env-file");
  if (!envFile) return null;
  const parsed = parseEnvFile(envFile);
  for (const [key, value] of Object.entries(parsed)) {
    if (!process.env[key]) process.env[key] = value;
  }
  return path.resolve(process.cwd(), envFile);
}

function normalizeRepo(repo) {
  if (!repo) return repo;
  return repo.replace(/\.git$/, "");
}

function resolveRepo(flags) {
  const fromFlag = normalizeRepo(getFlagString(flags, "repo"));
  if (fromFlag) return fromFlag;
  const fromEnv = normalizeRepo((process.env.RENDER_REPO_URL || "").trim());
  if (fromEnv) return fromEnv;
  try {
    const fromGitCmd = normalizeRepo(String(execSync("git config --get remote.origin.url", { encoding: "utf8" })).trim());
    if (fromGitCmd) return fromGitCmd;
  } catch {
    // no-op
  }
  const fromGit = normalizeRepo(
    String(
      fs
        .readFileSync(path.join(process.cwd(), ".git", "config"), "utf8")
        .match(/\[remote "origin"\][\s\S]*?url = (.+)/)?.[1] || ""
    ).trim()
  );
  if (fromGit) return fromGit;
  throw new Error("Missing repo URL. Pass --repo or set RENDER_REPO_URL.");
}

async function renderRequest({ apiKey, method, endpoint, body }) {
  const retryMax = Number(process.env.RENDER_API_RETRY_MAX || DEFAULT_API_RETRY_MAX);

  for (let attempt = 1; attempt <= retryMax; attempt += 1) {
    const response = await fetch(`${RENDER_API_BASE}${endpoint}`, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: body ? JSON.stringify(body) : undefined
    });

    const raw = await response.text();
    let data = null;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch {
      data = { raw };
    }

    if (response.ok) return data;

    const retryAfterHeader = response.headers.get("retry-after");
    const retryAfterSec = Number(retryAfterHeader);
    const shouldRetry = response.status === 429 || response.status >= 500;
    if (shouldRetry && attempt < retryMax) {
      const waitSec = Number.isFinite(retryAfterSec) && retryAfterSec > 0 ? retryAfterSec : Math.min(30 * attempt, 300);
      console.error(
        `[render-moltbook-cron-api] ${method} ${endpoint} got ${response.status}; retrying in ${waitSec}s (attempt ${attempt}/${retryMax})`
      );
      await new Promise((resolve) => setTimeout(resolve, waitSec * 1000));
      continue;
    }

    const message = data?.message || data?.error || response.statusText || "request failed";
    throw new Error(`${method} ${endpoint} failed: ${response.status} ${message}`);
  }
  throw new Error(`${method} ${endpoint} failed: exhausted retries`);
}

async function listOwners(apiKey) {
  return renderRequest({ apiKey, method: "GET", endpoint: "/owners" });
}

async function listServices(apiKey, ownerId) {
  const rows = [];
  let cursor = "";
  while (true) {
    const qs = new URLSearchParams({ ownerId, limit: "100" });
    if (cursor) qs.set("cursor", cursor);
    const page = await renderRequest({
      apiKey,
      method: "GET",
      endpoint: `/services?${qs.toString()}`
    });
    if (!Array.isArray(page) || page.length === 0) break;
    rows.push(...page.map((entry) => entry.service));
    const nextCursor = page[page.length - 1]?.cursor || "";
    if (!nextCursor) break;
    cursor = nextCursor;
  }
  return rows;
}

async function getEnvVars(apiKey, serviceId) {
  const data = await renderRequest({
    apiKey,
    method: "GET",
    endpoint: `/services/${serviceId}/env-vars`
  });
  if (!Array.isArray(data)) return [];
  return data
    .map((row) => row?.envVar)
    .filter(Boolean)
    .map((row) => ({ key: row.key, value: row.value }));
}

function mapByKey(envVars) {
  const mapped = {};
  for (const row of envVars) mapped[row.key] = row.value;
  return mapped;
}

function normalizeComparable(job, envVars) {
  const envByKey = mapByKey(envVars);
  return {
    name: job.name,
    repo: job.repo,
    branch: job.branch,
    region: job.region,
    plan: job.plan,
    schedule: job.schedule,
    buildCommand: job.buildCommand,
    startCommand: job.startCommand,
    autoDeploy: job.autoDeploy,
    env: {
      MOLTBOOK_BASE_URL: envByKey.MOLTBOOK_BASE_URL || "",
      MOLTBOOK_WATCH_POST_IDS: envByKey.MOLTBOOK_WATCH_POST_IDS || "",
      MOLTBOOK_REPLY_MAX_PER_RUN: envByKey.MOLTBOOK_REPLY_MAX_PER_RUN || "",
      MOLTBOOK_API_KEY: envByKey.MOLTBOOK_API_KEY ? "__SET__" : "__MISSING__",
      MOLTBOOK_STATE_BACKEND: envByKey.MOLTBOOK_STATE_BACKEND || "",
      DATABASE_URL: envByKey.DATABASE_URL ? "__SET__" : "__MISSING__",
      PGSSLMODE: envByKey.PGSSLMODE || ""
    }
  };
}

function hasDrift(desiredComparable, currentComparable) {
  return JSON.stringify(desiredComparable) !== JSON.stringify(currentComparable);
}

function buildDesiredJobs(flags, repo) {
  const branch = getFlagString(flags, "branch", process.env.RENDER_BRANCH || DEFAULT_BRANCH);
  const region = getFlagString(flags, "region", process.env.RENDER_REGION || DEFAULT_REGION);
  const plan = getFlagString(flags, "plan", process.env.RENDER_PLAN || DEFAULT_PLAN);
  const buildCommand = getFlagString(flags, "build-command", process.env.RENDER_BUILD_COMMAND || DEFAULT_BUILD_COMMAND);
  const autoDeploy = getFlagString(flags, "auto-deploy", "no");
  const moltbookBaseUrl = getFlagString(
    flags,
    "moltbook-base-url",
    process.env.MOLTBOOK_BASE_URL || DEFAULT_MOLTBOOK_BASE_URL
  );
  const moltbookApiKey = (process.env.MOLTBOOK_API_KEY || "").trim();
  const moltbookStateBackend = (process.env.MOLTBOOK_STATE_BACKEND || "auto").trim();
  const databaseUrl = (process.env.DATABASE_URL || "").trim();
  const pgSslMode = (process.env.PGSSLMODE || "").trim();
  const watchPostIds = (process.env.MOLTBOOK_WATCH_POST_IDS || "").trim();

  const selectedNames = getFlagString(flags, "jobs")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  const selectedSet = new Set(selectedNames);
  const managed = selectedSet.size > 0 ? MANAGED_JOBS.filter((row) => selectedSet.has(row.name)) : MANAGED_JOBS;

  return managed.map((row) => {
    const envVars = [
      { key: "MOLTBOOK_BASE_URL", value: moltbookBaseUrl },
      { key: "MOLTBOOK_API_KEY", value: moltbookApiKey },
      { key: "MOLTBOOK_REPLY_MAX_PER_RUN", value: "1" },
      { key: "MOLTBOOK_STATE_BACKEND", value: moltbookStateBackend }
    ];
    if (databaseUrl) envVars.push({ key: "DATABASE_URL", value: databaseUrl });
    if (pgSslMode) envVars.push({ key: "PGSSLMODE", value: pgSslMode });
    if (watchPostIds) envVars.push({ key: "MOLTBOOK_WATCH_POST_IDS", value: watchPostIds });

    return {
      ...row,
      repo,
      branch,
      region,
      plan,
      buildCommand,
      autoDeploy,
      envVars
    };
  });
}

async function createCron(apiKey, ownerId, job) {
  return renderRequest({
    apiKey,
    method: "POST",
    endpoint: "/services",
    body: {
      ownerID: ownerId,
      type: "cron_job",
      name: job.name,
      repo: job.repo,
      branch: job.branch,
      autoDeploy: job.autoDeploy,
      envVars: job.envVars,
      serviceDetails: {
        runtime: "node",
        region: job.region,
        plan: job.plan,
        schedule: job.schedule,
        envSpecificDetails: {
          buildCommand: job.buildCommand,
          startCommand: job.startCommand
        }
      }
    }
  });
}

async function deleteService(apiKey, serviceId) {
  return renderRequest({
    apiKey,
    method: "DELETE",
    endpoint: `/services/${serviceId}`
  });
}

function sanitizePlanRows(rows) {
  return rows.map((row) => ({
    ...row,
    desired: row.desired
      ? {
          ...row.desired,
          envVars: row.desired.envVars.map((item) => ({
            key: item.key,
            value: ["MOLTBOOK_API_KEY", "DATABASE_URL"].includes(item.key) ? "__REDACTED__" : item.value
          }))
        }
      : null
  }));
}

async function main() {
  const { command, flags } = parseArgs(process.argv.slice(2));
  if (command === "help" || command === "--help" || command === "-h") {
    console.log(usage());
    return;
  }

  const loadedEnvFile = applyEnvFileIfProvided(flags);
  const apiKey = (process.env.RENDER_API_KEY || "").trim();
  if (!apiKey) throw new Error("Missing RENDER_API_KEY");

  const ownerIdFromFlag = getFlagString(flags, "owner-id");
  let ownerId = ownerIdFromFlag;
  if (!ownerId) {
    const owners = await listOwners(apiKey);
    const first = Array.isArray(owners) ? owners[0] : null;
    ownerId = first?.owner?.id || "";
  }
  if (!ownerId) throw new Error("Failed to resolve owner ID. Pass --owner-id.");

  const repo = resolveRepo(flags);
  const desiredJobs = buildDesiredJobs(flags, repo);
  if (desiredJobs.length === 0) throw new Error("No jobs selected. Check --jobs values.");

  if (command === "apply" && !process.env.MOLTBOOK_API_KEY) {
    throw new Error("apply requires MOLTBOOK_API_KEY (env or --env-file)");
  }

  const services = await listServices(apiKey, ownerId);
  const existingCronByName = new Map(
    services
      .filter((row) => row.type === "cron_job")
      .map((row) => [row.name, row])
  );

  const planRows = [];
  for (const desired of desiredJobs) {
    const existing = existingCronByName.get(desired.name) || null;
    if (!existing) {
      planRows.push({
        name: desired.name,
        action: "create",
        reason: "missing",
        desired
      });
      continue;
    }

    const existingEnvVars = await getEnvVars(apiKey, existing.id);
    const desiredComparable = normalizeComparable(desired, desired.envVars);
    const currentComparable = normalizeComparable(
      {
        name: existing.name,
        repo: existing.repo || "",
        branch: existing.branch || "",
        region: existing.serviceDetails?.region || "",
        plan: existing.serviceDetails?.plan || "",
        schedule: existing.serviceDetails?.schedule || "",
        buildCommand: existing.serviceDetails?.envSpecificDetails?.buildCommand || "",
        startCommand: existing.serviceDetails?.envSpecificDetails?.startCommand || "",
        autoDeploy: existing.autoDeploy || "no"
      },
      existingEnvVars
    );
    if (hasDrift(desiredComparable, currentComparable)) {
      planRows.push({
        name: desired.name,
        action: "recreate",
        reason: "drift",
        desired,
        existing: { id: existing.id }
      });
      continue;
    }

    planRows.push({
      name: desired.name,
      action: "noop",
      reason: "up_to_date",
      existing: { id: existing.id }
    });
  }

  if (command === "plan") {
    console.log(
      JSON.stringify(
        {
          mode: "plan",
          owner_id: ownerId,
          repo,
          env_file_loaded: loadedEnvFile || null,
          replace_changed: flags["replace-changed"] === true,
          jobs: sanitizePlanRows(planRows)
        },
        null,
        2
      )
    );
    return;
  }

  if (command !== "apply") {
    throw new Error(`Unknown command: ${command}\n\n${usage()}`);
  }

  const replaceChanged = flags["replace-changed"] === true;
  const applied = [];
  for (const row of planRows) {
    if (row.action === "noop") {
      applied.push({ name: row.name, result: "noop" });
      continue;
    }
    if (row.action === "create") {
      const created = await createCron(apiKey, ownerId, row.desired);
      applied.push({
        name: row.name,
        result: "created",
        id: created?.service?.id || null
      });
      continue;
    }
    if (row.action === "recreate" && !replaceChanged) {
      applied.push({
        name: row.name,
        result: "skipped_drift",
        reason: "run apply with --replace-changed"
      });
      continue;
    }
    if (row.action === "recreate" && replaceChanged) {
      await deleteService(apiKey, row.existing.id);
      const created = await createCron(apiKey, ownerId, row.desired);
      applied.push({
        name: row.name,
        result: "recreated",
        old_id: row.existing.id,
        new_id: created?.service?.id || null
      });
    }
  }

  console.log(
    JSON.stringify(
      {
        mode: "apply",
        owner_id: ownerId,
        repo,
        env_file_loaded: loadedEnvFile || null,
        replace_changed: replaceChanged,
        jobs: applied
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(`[render-moltbook-cron-api] ${error.message}`);
  process.exitCode = 1;
});
