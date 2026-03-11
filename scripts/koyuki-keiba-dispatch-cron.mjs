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

async function main() {
  if (!MARKETING_API_KEY) {
    console.error("dispatch cron failed: MARKETING_API_KEY is not configured");
    process.exitCode = 1;
    return;
  }

  const response = await fetch(`${API_BASE_URL}/api/marketing/dispatch`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-marketing-api-key": MARKETING_API_KEY
    },
    body: "{}",
    signal: AbortSignal.timeout(15000)
  });

  const raw = await response.text();
  if (!response.ok) {
    console.error(`dispatch cron failed: http ${response.status}`);
    if (raw) console.error(raw);
    process.exitCode = 1;
    return;
  }

  if (raw) {
    console.log(raw);
    return;
  }
  console.log(JSON.stringify({ status: "ok" }));
}

main().catch((error) => {
  console.error("dispatch cron failed", error);
  process.exitCode = 1;
});
