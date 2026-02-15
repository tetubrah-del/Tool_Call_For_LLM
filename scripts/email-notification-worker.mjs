import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import Database from "better-sqlite3";
import pg from "pg";

const { Pool } = pg;

const DB_PATH = path.join(process.cwd(), "data", "app.db");
const DATABASE_URL = (process.env.DATABASE_URL || "").trim();
const RESEND_API_KEY = (process.env.RESEND_API_KEY || "").trim();
const NOTIFICATION_FROM_EMAIL = (process.env.NOTIFICATION_FROM_EMAIL || "").trim();
const POLL_INTERVAL_MS = Number(process.env.EMAIL_WORKER_POLL_MS || 15000);
const BATCH_SIZE = Number(process.env.EMAIL_WORKER_BATCH_SIZE || 20);
const CONTINUOUS = process.env.EMAIL_WORKER_CONTINUOUS === "true";

function nowIso() {
  return new Date().toISOString();
}

function toPgSql(sql) {
  let index = 0;
  let out = "";
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    if (ch === "?") {
      index += 1;
      out += `$${index}`;
    } else {
      out += ch;
    }
  }
  return out;
}

function getPgPool() {
  const pgSslMode = (process.env.PGSSLMODE || "").trim().toLowerCase();
  let useSsl = false;
  let connectionString = DATABASE_URL;
  try {
    const parsed = new URL(DATABASE_URL);
    const sslModeFromUrl = parsed.searchParams.get("sslmode")?.trim().toLowerCase();
    const sslFromUrl = parsed.searchParams.get("ssl")?.trim().toLowerCase();
    useSsl =
      sslModeFromUrl === "require" ||
      sslModeFromUrl === "prefer" ||
      sslFromUrl === "true" ||
      sslFromUrl === "1";
    if (useSsl) {
      parsed.searchParams.delete("sslmode");
      parsed.searchParams.delete("ssl");
      connectionString = parsed.toString();
    }
  } catch {
    const lowerUrl = DATABASE_URL.toLowerCase();
    useSsl = lowerUrl.includes("sslmode=require") || lowerUrl.includes("ssl=true");
  }
  if (pgSslMode === "require") useSsl = true;
  return new Pool({
    connectionString,
    ssl: useSsl ? { rejectUnauthorized: false } : undefined
  });
}

function openSqlite() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  return db;
}

function buildDb() {
  if (DATABASE_URL) {
    const pool = getPgPool();
    return {
      async all(sql, params = []) {
        const result = await pool.query(toPgSql(sql), params);
        return result.rows;
      },
      async run(sql, params = []) {
        const result = await pool.query(toPgSql(sql), params);
        return result.rowCount ?? 0;
      },
      async close() {
        await pool.end();
      }
    };
  }
  const db = openSqlite();
  return {
    async all(sql, params = []) {
      return db.prepare(sql).all(...params);
    },
    async run(sql, params = []) {
      const result = db.prepare(sql).run(...params);
      return result.changes;
    },
    async close() {
      db.close();
    }
  };
}

function nextBackoffSeconds(attemptCount) {
  const schedule = [60, 300, 1800, 7200, 43200];
  return schedule[Math.min(attemptCount, schedule.length - 1)];
}

async function sendViaResend(delivery) {
  if (!RESEND_API_KEY || !NOTIFICATION_FROM_EMAIL) {
    throw new Error("email_provider_not_configured");
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: NOTIFICATION_FROM_EMAIL,
      to: [delivery.to_email],
      subject: delivery.subject,
      text: delivery.body_text
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const reason = data?.message || `provider_http_${response.status}`;
    throw new Error(String(reason));
  }
  return String(data?.id || "");
}

async function claimQueuedDeliveries(db) {
  return db.all(
    `SELECT id, to_email, subject, body_text, attempt_count
     FROM email_deliveries
     WHERE status = 'queued'
       AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
     ORDER BY created_at ASC
     LIMIT ?`,
    [nowIso(), BATCH_SIZE]
  );
}

async function processDelivery(db, delivery) {
  const claiming = await db.run(
    `UPDATE email_deliveries
     SET status = 'sending', updated_at = ?
     WHERE id = ? AND status = 'queued'`,
    [nowIso(), delivery.id]
  );
  if (claiming < 1) return;

  try {
    const providerMessageId = await sendViaResend(delivery);
    await db.run(
      `UPDATE email_deliveries
       SET status = 'sent',
           provider_message_id = ?,
           sent_at = ?,
           updated_at = ?
       WHERE id = ?`,
      [providerMessageId || null, nowIso(), nowIso(), delivery.id]
    );
  } catch (error) {
    const nextAttemptCount = Number(delivery.attempt_count || 0) + 1;
    const deadLetter = nextAttemptCount >= 5;
    const nextAttemptAt = new Date(
      Date.now() + nextBackoffSeconds(nextAttemptCount - 1) * 1000
    ).toISOString();
    await db.run(
      `UPDATE email_deliveries
       SET status = ?,
           attempt_count = ?,
           next_attempt_at = ?,
           last_error = ?,
           updated_at = ?
       WHERE id = ?`,
      [
        deadLetter ? "dead_letter" : "queued",
        nextAttemptCount,
        deadLetter ? null : nextAttemptAt,
        error instanceof Error ? error.message : "unknown_error",
        nowIso(),
        delivery.id
      ]
    );
  }
}

async function runOnce(db) {
  const deliveries = await claimQueuedDeliveries(db);
  for (const delivery of deliveries) {
    // eslint-disable-next-line no-await-in-loop
    await processDelivery(db, delivery);
  }
  return deliveries.length;
}

async function main() {
  const db = buildDb();
  try {
    if (!CONTINUOUS) {
      await runOnce(db);
      return;
    }
    // eslint-disable-next-line no-constant-condition
    while (true) {
      // eslint-disable-next-line no-await-in-loop
      const handled = await runOnce(db);
      const waitMs = handled > 0 ? 1000 : POLL_INTERVAL_MS;
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error("email notification worker failed", error);
  process.exit(1);
});
