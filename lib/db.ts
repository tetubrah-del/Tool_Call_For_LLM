import fs from "fs";
import path from "path";
import crypto from "crypto";
import Database from "better-sqlite3";
import { Pool } from "pg";
import { startTimeoutSweeper } from "@/lib/timeout-sweeper";
import type { TaskLabel } from "@/lib/task-labels";

type QueryResult<T> = {
  rows: T[];
  rowCount: number;
};

export type DbClient = {
  prepare: (sql: string) => {
    get: <T = any>(...params: Array<string | number | null>) => Promise<T | undefined>;
    all: <T = any>(...params: Array<string | number | null>) => Promise<T[]>;
    run: (...params: Array<string | number | null>) => Promise<number>;
  };
  query: <T = any>(sql: string, params?: Array<string | number | null>) => Promise<QueryResult<T>>;
};

type DbMode = "postgres" | "sqlite";

const DB_PATH = path.join(process.cwd(), "data", "app.db");
const DATABASE_URL = process.env.DATABASE_URL?.trim();
const AI_API_KEY_PREFIX = "ai_live_";

let mode: DbMode | null = null;
let initPromise: Promise<void> | null = null;
let client: DbClient | null = null;
let sweeperStarted = false;
let pool: Pool | null = null;
let sqliteDb: Database.Database | null = null;

function resolveMode(): DbMode {
  return DATABASE_URL ? "postgres" : "sqlite";
}

function getPool() {
  if (!pool) {
    if (!DATABASE_URL) {
      throw new Error("DATABASE_URL is required for Postgres.");
    }
    const pgSslMode = process.env.PGSSLMODE?.trim().toLowerCase();
    let useSsl = false;
    let connectionString = DATABASE_URL;
    try {
      const parsed = new URL(DATABASE_URL);
      const sslModeFromUrl = parsed.searchParams.get("sslmode")?.trim().toLowerCase();
      const sslFromUrl = parsed.searchParams.get("ssl")?.trim().toLowerCase();
      useSsl =
        sslModeFromUrl === "require" ||
        sslModeFromUrl === "prefer" ||
        sslModeFromUrl === "verify-ca" ||
        sslModeFromUrl === "verify-full" ||
        sslModeFromUrl === "no-verify" ||
        sslFromUrl === "true" ||
        sslFromUrl === "1";
      if (useSsl) {
        // Keep SSL on the client options only to avoid URL sslmode overriding.
        parsed.searchParams.delete("sslmode");
        parsed.searchParams.delete("ssl");
        parsed.searchParams.delete("sslcert");
        parsed.searchParams.delete("sslkey");
        parsed.searchParams.delete("sslrootcert");
        connectionString = parsed.toString();
      }
    } catch {
      // Keep compatibility with non-standard connection strings.
      const lowerUrl = DATABASE_URL.toLowerCase();
      useSsl =
        lowerUrl.includes("sslmode=require") ||
        lowerUrl.includes("sslmode=prefer") ||
        lowerUrl.includes("ssl=true");
      connectionString = DATABASE_URL
        .replace(/sslmode=verify-full/gi, "")
        .replace(/sslmode=verify-ca/gi, "")
        .replace(/sslmode=require/gi, "")
        .replace(/sslmode=prefer/gi, "")
        .replace(/ssl=true/gi, "")
        .replace(/\?&/g, "?")
        .replace(/&&/g, "&")
        .replace(/[?&]$/, "");
    }
    if (pgSslMode === "require") {
      useSsl = true;
    }
    pool = new Pool({
      connectionString,
      ssl: useSsl ? { rejectUnauthorized: false } : undefined
    });
  }
  return pool;
}

function getSqliteDb() {
  if (!sqliteDb) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    sqliteDb = new Database(DB_PATH);
    sqliteDb.pragma("journal_mode = WAL");
  }
  return sqliteDb;
}

function toPgSql(sql: string) {
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

function ensureSqliteColumn(
  instance: Database.Database,
  table: string,
  column: string,
  type: string
) {
  const rows = instance.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (rows.some((row) => row.name === column)) return;
  instance.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}

function hashAiApiKeyForStorage(rawKey: string) {
  const pepper = process.env.AI_API_KEY_PEPPER || "";
  return crypto
    .createHash("sha256")
    .update(`${pepper}:${rawKey}`)
    .digest("hex");
}

function deriveAiApiKeyPrefix(rawKey: string): string {
  const idx = rawKey.indexOf("_", AI_API_KEY_PREFIX.length);
  if (rawKey.startsWith(AI_API_KEY_PREFIX) && idx > 0) {
    return rawKey.slice(0, idx);
  }
  return "legacy";
}

async function initPostgres() {
  const db = getPool();
  const statements = [
    `CREATE TABLE IF NOT EXISTS humans (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT,
      paypal_email TEXT,
      stripe_account_id TEXT,
      location TEXT,
      country TEXT NOT NULL,
      min_budget_usd DOUBLE PRECISION NOT NULL,
      headline TEXT,
      gender TEXT,
      bio TEXT,
      city TEXT,
      region TEXT,
      timezone TEXT,
      hourly_rate_usd DOUBLE PRECISION,
      skills_json TEXT,
      twitter_url TEXT,
      github_url TEXT,
      instagram_url TEXT,
      linkedin_url TEXT,
      website_url TEXT,
      youtube_url TEXT,
      payout_hold_status TEXT,
      payout_hold_reason TEXT,
      payout_hold_until TEXT,
      api_access_status TEXT NOT NULL DEFAULT 'active',
      api_monthly_limit INTEGER NOT NULL DEFAULT 1000,
      deleted_at TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS ai_accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      paypal_email TEXT NOT NULL,
      api_key TEXT NOT NULL DEFAULT '',
      api_key_hash TEXT,
      api_key_prefix TEXT,
      api_access_status TEXT NOT NULL DEFAULT 'active',
      api_monthly_limit INTEGER NOT NULL DEFAULT 50000,
      api_burst_per_minute INTEGER NOT NULL DEFAULT 60,
      deleted_at TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      task TEXT NOT NULL,
      task_en TEXT,
      location TEXT,
      budget_usd DOUBLE PRECISION NOT NULL,
      origin_country TEXT,
      task_label TEXT,
      acceptance_criteria TEXT,
      not_allowed TEXT,
      ai_account_id TEXT,
      payer_paypal_email TEXT,
      payee_paypal_email TEXT,
      deliverable TEXT,
      deadline_minutes DOUBLE PRECISION,
      deadline_at TEXT,
      review_pending_deadline_at TEXT,
      completed_at TEXT,
      review_deadline_at TEXT,
      deleted_at TEXT,
      status TEXT NOT NULL,
      failure_reason TEXT,
      human_id TEXT,
      submission_id TEXT,
      fee_rate DOUBLE PRECISION,
      fee_amount DOUBLE PRECISION,
      payout_amount DOUBLE PRECISION,
      paypal_fee_amount DOUBLE PRECISION,
      paid_status TEXT,
      approved_at TEXT,
      paid_at TEXT,
      paid_method TEXT,
      payout_batch_id TEXT,
      payment_error_message TEXT,
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS orders (
      id TEXT NOT NULL,
      version INTEGER NOT NULL,
      payment_flow TEXT NOT NULL,
      status TEXT NOT NULL,
      currency TEXT NOT NULL,
      base_amount_jpy INTEGER NOT NULL,
      fx_cost_jpy INTEGER NOT NULL,
      total_amount_jpy INTEGER NOT NULL,
      platform_fee_jpy INTEGER NOT NULL,
      intl_surcharge_minor INTEGER,
      payer_country TEXT NOT NULL,
      payee_country TEXT NOT NULL,
      is_international INTEGER NOT NULL,
      destination_account_id TEXT NOT NULL,
      human_id TEXT,
      task_id TEXT,
      checkout_session_id TEXT,
      payment_intent_id TEXT,
      charge_id TEXT,
      refund_status TEXT,
      refund_amount_minor INTEGER,
      refund_reason TEXT,
      refund_id TEXT,
      refunded_at TEXT,
      refund_error_message TEXT,
      mismatch_reason TEXT,
      provider_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (id, version)
    )`,
    `CREATE TABLE IF NOT EXISTS stripe_webhook_events (
      event_id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      event_created INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      received_at TEXT NOT NULL,
      status TEXT NOT NULL,
      processing_started_at TEXT,
      processed_at TEXT,
      processing_error TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS task_translations (
      task_id TEXT NOT NULL,
      lang TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (task_id, lang)
    )`,
    `CREATE TABLE IF NOT EXISTS submissions (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      type TEXT NOT NULL,
      content_url TEXT,
      text TEXT,
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS human_photos (
      id TEXT PRIMARY KEY,
      human_id TEXT NOT NULL,
      photo_url TEXT NOT NULL,
      is_public INTEGER NOT NULL,
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS human_inquiries (
      id TEXT PRIMARY KEY,
      human_id TEXT NOT NULL,
      from_name TEXT,
      from_email TEXT,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS oauth_users (
      email TEXT PRIMARY KEY,
      name TEXT,
      image TEXT,
      provider TEXT NOT NULL DEFAULT 'google',
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS message_templates (
      id TEXT PRIMARY KEY,
      human_id TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS task_contacts (
      task_id TEXT PRIMARY KEY,
      ai_account_id TEXT NOT NULL,
      human_id TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      opened_at TEXT,
      closed_at TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS contact_messages (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      sender_type TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      body TEXT NOT NULL,
      attachment_url TEXT,
      created_at TEXT NOT NULL,
      read_by_ai INTEGER NOT NULL DEFAULT 0,
      read_by_human INTEGER NOT NULL DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS task_review_guards (
      task_id TEXT PRIMARY KEY,
      ai_account_id TEXT NOT NULL,
      recognized_message_id TEXT,
      recognized_submission_id TEXT,
      has_attachment INTEGER NOT NULL DEFAULT 0,
      attachment_checked INTEGER NOT NULL DEFAULT 0,
      acceptance_checked INTEGER NOT NULL DEFAULT 0,
      final_confirmed INTEGER NOT NULL DEFAULT 0,
      review_note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS task_reviews (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      reviewer_type TEXT NOT NULL,
      reviewer_id TEXT NOT NULL,
      reviewee_type TEXT NOT NULL,
      reviewee_id TEXT NOT NULL,
      rating_overall INTEGER NOT NULL,
      comment TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      published_at TEXT,
      is_hidden INTEGER NOT NULL DEFAULT 0
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS task_reviews_task_reviewer_idx
      ON task_reviews (task_id, reviewer_type)`,
    `CREATE INDEX IF NOT EXISTS task_reviews_reviewee_published_idx
      ON task_reviews (reviewee_type, reviewee_id, published_at)`,
    `CREATE TABLE IF NOT EXISTS task_applications (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      human_id TEXT NOT NULL,
      cover_letter TEXT NOT NULL,
      availability TEXT NOT NULL,
      counter_budget_usd DOUBLE PRECISION,
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS task_comments (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      human_id TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS idempotency_keys (
      route TEXT NOT NULL,
      idem_key TEXT NOT NULL,
      ai_account_id TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      status_code INTEGER,
      response_body TEXT,
      created_at TEXT NOT NULL,
      PRIMARY KEY (route, idem_key, ai_account_id)
    )`,
    `CREATE TABLE IF NOT EXISTS webhook_endpoints (
      id TEXT PRIMARY KEY,
      ai_account_id TEXT NOT NULL,
      url TEXT NOT NULL,
      secret TEXT NOT NULL,
      status TEXT NOT NULL,
      events TEXT,
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS webhook_deliveries (
      id TEXT PRIMARY KEY,
      webhook_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      task_id TEXT NOT NULL,
      status_code INTEGER,
      response_body TEXT,
      error TEXT,
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS human_api_keys (
      id TEXT PRIMARY KEY,
      human_id TEXT NOT NULL,
      name TEXT NOT NULL,
      key_prefix TEXT NOT NULL,
      key_hash TEXT NOT NULL,
      scopes_json TEXT NOT NULL,
      status TEXT NOT NULL,
      last_used_at TEXT,
      expires_at TEXT,
      revoked_at TEXT,
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS human_api_usage_monthly (
      human_id TEXT NOT NULL,
      period_key TEXT NOT NULL,
      request_count INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (human_id, period_key)
    )`,
    `CREATE TABLE IF NOT EXISTS human_api_usage_alerts (
      human_id TEXT NOT NULL,
      period_key TEXT NOT NULL,
      threshold_percent INTEGER NOT NULL,
      notified_at TEXT NOT NULL,
      PRIMARY KEY (human_id, period_key, threshold_percent)
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS human_api_keys_key_hash_idx ON human_api_keys (key_hash)`,
    `CREATE INDEX IF NOT EXISTS human_api_keys_human_status_idx ON human_api_keys (human_id, status)`,
    `CREATE TABLE IF NOT EXISTS ai_api_usage_monthly (
      ai_account_id TEXT NOT NULL,
      period_key TEXT NOT NULL,
      request_count INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (ai_account_id, period_key)
    )`,
    `CREATE TABLE IF NOT EXISTS ai_api_usage_minute (
      ai_account_id TEXT NOT NULL,
      bucket_key TEXT NOT NULL,
      request_count INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (ai_account_id, bucket_key)
    )`,
    `CREATE TABLE IF NOT EXISTS ai_api_usage_alerts (
      ai_account_id TEXT NOT NULL,
      period_key TEXT NOT NULL,
      threshold_percent INTEGER NOT NULL,
      notified_at TEXT NOT NULL,
      PRIMARY KEY (ai_account_id, period_key, threshold_percent)
    )`,
    `CREATE TABLE IF NOT EXISTS human_notification_settings (
      human_id TEXT PRIMARY KEY,
      email_enabled INTEGER NOT NULL DEFAULT 1,
      notify_task_accepted INTEGER NOT NULL DEFAULT 1,
      notify_ai_message INTEGER NOT NULL DEFAULT 1,
      quiet_hours_start TEXT,
      quiet_hours_end TEXT,
      timezone TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS notification_events (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      task_id TEXT NOT NULL,
      human_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      payload_json TEXT,
      created_at TEXT NOT NULL
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS notification_events_idempotency_idx
      ON notification_events (idempotency_key)`,
    `CREATE TABLE IF NOT EXISTS email_deliveries (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      to_email TEXT NOT NULL,
      template_key TEXT NOT NULL,
      subject TEXT NOT NULL,
      body_text TEXT NOT NULL,
      status TEXT NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TEXT,
      provider_message_id TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      sent_at TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS email_deliveries_status_next_attempt_idx
      ON email_deliveries (status, next_attempt_at)`
  ];

  for (const statement of statements) {
    await db.query(statement);
  }

  const migrationStatements = [
    `ALTER TABLE humans ADD COLUMN IF NOT EXISTS email TEXT`,
    `ALTER TABLE humans ADD COLUMN IF NOT EXISTS paypal_email TEXT`,
    `ALTER TABLE humans ADD COLUMN IF NOT EXISTS stripe_account_id TEXT`,
    `ALTER TABLE humans ADD COLUMN IF NOT EXISTS country TEXT`,
    `ALTER TABLE humans ADD COLUMN IF NOT EXISTS headline TEXT`,
    `ALTER TABLE humans ADD COLUMN IF NOT EXISTS gender TEXT`,
    `ALTER TABLE humans ADD COLUMN IF NOT EXISTS bio TEXT`,
    `ALTER TABLE humans ADD COLUMN IF NOT EXISTS city TEXT`,
    `ALTER TABLE humans ADD COLUMN IF NOT EXISTS region TEXT`,
    `ALTER TABLE humans ADD COLUMN IF NOT EXISTS timezone TEXT`,
    `ALTER TABLE humans ADD COLUMN IF NOT EXISTS hourly_rate_usd DOUBLE PRECISION`,
    `ALTER TABLE humans ADD COLUMN IF NOT EXISTS skills_json TEXT`,
    `ALTER TABLE humans ADD COLUMN IF NOT EXISTS twitter_url TEXT`,
    `ALTER TABLE humans ADD COLUMN IF NOT EXISTS github_url TEXT`,
    `ALTER TABLE humans ADD COLUMN IF NOT EXISTS instagram_url TEXT`,
    `ALTER TABLE humans ADD COLUMN IF NOT EXISTS linkedin_url TEXT`,
    `ALTER TABLE humans ADD COLUMN IF NOT EXISTS website_url TEXT`,
    `ALTER TABLE humans ADD COLUMN IF NOT EXISTS youtube_url TEXT`,
    `ALTER TABLE humans ADD COLUMN IF NOT EXISTS payout_hold_status TEXT`,
    `ALTER TABLE humans ADD COLUMN IF NOT EXISTS payout_hold_reason TEXT`,
    `ALTER TABLE humans ADD COLUMN IF NOT EXISTS payout_hold_until TEXT`,
    `ALTER TABLE humans ADD COLUMN IF NOT EXISTS api_access_status TEXT`,
    `ALTER TABLE humans ADD COLUMN IF NOT EXISTS api_monthly_limit INTEGER`,
    `ALTER TABLE humans ADD COLUMN IF NOT EXISTS deleted_at TEXT`,
    `ALTER TABLE ai_accounts ADD COLUMN IF NOT EXISTS deleted_at TEXT`,
    `ALTER TABLE ai_accounts ADD COLUMN IF NOT EXISTS api_key_hash TEXT`,
    `ALTER TABLE ai_accounts ADD COLUMN IF NOT EXISTS api_key_prefix TEXT`,
    `ALTER TABLE ai_accounts ADD COLUMN IF NOT EXISTS api_access_status TEXT`,
    `ALTER TABLE ai_accounts ADD COLUMN IF NOT EXISTS api_monthly_limit INTEGER`,
    `ALTER TABLE ai_accounts ADD COLUMN IF NOT EXISTS api_burst_per_minute INTEGER`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS deleted_at TEXT`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS task_en TEXT`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS origin_country TEXT`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS task_label TEXT`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS acceptance_criteria TEXT`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS not_allowed TEXT`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS ai_account_id TEXT`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS payer_paypal_email TEXT`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS payee_paypal_email TEXT`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS deadline_at TEXT`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS review_pending_deadline_at TEXT`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completed_at TEXT`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS review_deadline_at TEXT`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS failure_reason TEXT`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS submission_id TEXT`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS fee_rate DOUBLE PRECISION`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS fee_amount DOUBLE PRECISION`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS payout_amount DOUBLE PRECISION`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS paypal_fee_amount DOUBLE PRECISION`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS paid_status TEXT`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS approved_at TEXT`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS paid_at TEXT`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS paid_method TEXT`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS payout_batch_id TEXT`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS payment_error_message TEXT`,
    `ALTER TABLE human_photos ADD COLUMN IF NOT EXISTS is_public INTEGER`,
    `ALTER TABLE human_inquiries ADD COLUMN IF NOT EXISTS is_read INTEGER`,
    `ALTER TABLE message_templates ADD COLUMN IF NOT EXISTS updated_at TEXT`,
    `ALTER TABLE task_contacts ADD COLUMN IF NOT EXISTS opened_at TEXT`,
    `ALTER TABLE task_contacts ADD COLUMN IF NOT EXISTS closed_at TEXT`,
    `ALTER TABLE contact_messages ADD COLUMN IF NOT EXISTS attachment_url TEXT`,
    `ALTER TABLE contact_messages ADD COLUMN IF NOT EXISTS read_by_ai INTEGER`,
    `ALTER TABLE contact_messages ADD COLUMN IF NOT EXISTS read_by_human INTEGER`,
    `CREATE TABLE IF NOT EXISTS task_review_guards (
      task_id TEXT PRIMARY KEY,
      ai_account_id TEXT NOT NULL,
      recognized_message_id TEXT,
      recognized_submission_id TEXT,
      has_attachment INTEGER NOT NULL DEFAULT 0,
      attachment_checked INTEGER NOT NULL DEFAULT 0,
      acceptance_checked INTEGER NOT NULL DEFAULT 0,
      final_confirmed INTEGER NOT NULL DEFAULT 0,
      review_note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `ALTER TABLE task_review_guards ADD COLUMN IF NOT EXISTS recognized_message_id TEXT`,
    `ALTER TABLE task_review_guards ADD COLUMN IF NOT EXISTS recognized_submission_id TEXT`,
    `ALTER TABLE task_review_guards ADD COLUMN IF NOT EXISTS has_attachment INTEGER`,
    `ALTER TABLE task_review_guards ADD COLUMN IF NOT EXISTS attachment_checked INTEGER`,
    `ALTER TABLE task_review_guards ADD COLUMN IF NOT EXISTS acceptance_checked INTEGER`,
    `ALTER TABLE task_review_guards ADD COLUMN IF NOT EXISTS final_confirmed INTEGER`,
    `ALTER TABLE task_review_guards ADD COLUMN IF NOT EXISTS review_note TEXT`,
    `ALTER TABLE task_review_guards ADD COLUMN IF NOT EXISTS created_at TEXT`,
    `ALTER TABLE task_review_guards ADD COLUMN IF NOT EXISTS updated_at TEXT`,
    `CREATE TABLE IF NOT EXISTS task_reviews (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      reviewer_type TEXT NOT NULL,
      reviewer_id TEXT NOT NULL,
      reviewee_type TEXT NOT NULL,
      reviewee_id TEXT NOT NULL,
      rating_overall INTEGER NOT NULL,
      comment TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      published_at TEXT,
      is_hidden INTEGER NOT NULL DEFAULT 0
    )`,
    `ALTER TABLE task_reviews ADD COLUMN IF NOT EXISTS task_id TEXT`,
    `ALTER TABLE task_reviews ADD COLUMN IF NOT EXISTS reviewer_type TEXT`,
    `ALTER TABLE task_reviews ADD COLUMN IF NOT EXISTS reviewer_id TEXT`,
    `ALTER TABLE task_reviews ADD COLUMN IF NOT EXISTS reviewee_type TEXT`,
    `ALTER TABLE task_reviews ADD COLUMN IF NOT EXISTS reviewee_id TEXT`,
    `ALTER TABLE task_reviews ADD COLUMN IF NOT EXISTS rating_overall INTEGER`,
    `ALTER TABLE task_reviews ADD COLUMN IF NOT EXISTS comment TEXT`,
    `ALTER TABLE task_reviews ADD COLUMN IF NOT EXISTS created_at TEXT`,
    `ALTER TABLE task_reviews ADD COLUMN IF NOT EXISTS updated_at TEXT`,
    `ALTER TABLE task_reviews ADD COLUMN IF NOT EXISTS published_at TEXT`,
    `ALTER TABLE task_reviews ADD COLUMN IF NOT EXISTS is_hidden INTEGER`,
    `CREATE UNIQUE INDEX IF NOT EXISTS task_reviews_task_reviewer_idx
      ON task_reviews (task_id, reviewer_type)`,
    `CREATE INDEX IF NOT EXISTS task_reviews_reviewee_published_idx
      ON task_reviews (reviewee_type, reviewee_id, published_at)`,
    `ALTER TABLE idempotency_keys ADD COLUMN IF NOT EXISTS status_code INTEGER`,
    `ALTER TABLE idempotency_keys ADD COLUMN IF NOT EXISTS response_body TEXT`,
    `ALTER TABLE webhook_endpoints ADD COLUMN IF NOT EXISTS events TEXT`,
    `ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS status_code INTEGER`,
    `ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS response_body TEXT`,
    `ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS error TEXT`,
    `CREATE TABLE IF NOT EXISTS human_api_keys (
      id TEXT PRIMARY KEY,
      human_id TEXT NOT NULL,
      name TEXT NOT NULL,
      key_prefix TEXT NOT NULL,
      key_hash TEXT NOT NULL,
      scopes_json TEXT NOT NULL,
      status TEXT NOT NULL,
      last_used_at TEXT,
      expires_at TEXT,
      revoked_at TEXT,
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS human_api_usage_monthly (
      human_id TEXT NOT NULL,
      period_key TEXT NOT NULL,
      request_count INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (human_id, period_key)
    )`,
    `CREATE TABLE IF NOT EXISTS human_api_usage_alerts (
      human_id TEXT NOT NULL,
      period_key TEXT NOT NULL,
      threshold_percent INTEGER NOT NULL,
      notified_at TEXT NOT NULL,
      PRIMARY KEY (human_id, period_key, threshold_percent)
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS human_api_keys_key_hash_idx ON human_api_keys (key_hash)`,
    `CREATE INDEX IF NOT EXISTS human_api_keys_human_status_idx ON human_api_keys (human_id, status)`,
    `CREATE TABLE IF NOT EXISTS ai_api_usage_monthly (
      ai_account_id TEXT NOT NULL,
      period_key TEXT NOT NULL,
      request_count INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (ai_account_id, period_key)
    )`,
    `CREATE TABLE IF NOT EXISTS ai_api_usage_minute (
      ai_account_id TEXT NOT NULL,
      bucket_key TEXT NOT NULL,
      request_count INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (ai_account_id, bucket_key)
    )`,
    `CREATE TABLE IF NOT EXISTS ai_api_usage_alerts (
      ai_account_id TEXT NOT NULL,
      period_key TEXT NOT NULL,
      threshold_percent INTEGER NOT NULL,
      notified_at TEXT NOT NULL,
      PRIMARY KEY (ai_account_id, period_key, threshold_percent)
    )`,
    `CREATE TABLE IF NOT EXISTS human_notification_settings (
      human_id TEXT PRIMARY KEY,
      email_enabled INTEGER NOT NULL DEFAULT 1,
      notify_task_accepted INTEGER NOT NULL DEFAULT 1,
      notify_ai_message INTEGER NOT NULL DEFAULT 1,
      quiet_hours_start TEXT,
      quiet_hours_end TEXT,
      timezone TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `ALTER TABLE human_notification_settings ADD COLUMN IF NOT EXISTS email_enabled INTEGER`,
    `ALTER TABLE human_notification_settings ADD COLUMN IF NOT EXISTS notify_task_accepted INTEGER`,
    `ALTER TABLE human_notification_settings ADD COLUMN IF NOT EXISTS notify_ai_message INTEGER`,
    `ALTER TABLE human_notification_settings ADD COLUMN IF NOT EXISTS quiet_hours_start TEXT`,
    `ALTER TABLE human_notification_settings ADD COLUMN IF NOT EXISTS quiet_hours_end TEXT`,
    `ALTER TABLE human_notification_settings ADD COLUMN IF NOT EXISTS timezone TEXT`,
    `ALTER TABLE human_notification_settings ADD COLUMN IF NOT EXISTS created_at TEXT`,
    `ALTER TABLE human_notification_settings ADD COLUMN IF NOT EXISTS updated_at TEXT`,
    `CREATE TABLE IF NOT EXISTS notification_events (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      task_id TEXT NOT NULL,
      human_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      payload_json TEXT,
      created_at TEXT NOT NULL
    )`,
    `ALTER TABLE notification_events ADD COLUMN IF NOT EXISTS event_type TEXT`,
    `ALTER TABLE notification_events ADD COLUMN IF NOT EXISTS task_id TEXT`,
    `ALTER TABLE notification_events ADD COLUMN IF NOT EXISTS human_id TEXT`,
    `ALTER TABLE notification_events ADD COLUMN IF NOT EXISTS idempotency_key TEXT`,
    `ALTER TABLE notification_events ADD COLUMN IF NOT EXISTS payload_json TEXT`,
    `ALTER TABLE notification_events ADD COLUMN IF NOT EXISTS created_at TEXT`,
    `CREATE UNIQUE INDEX IF NOT EXISTS notification_events_idempotency_idx
      ON notification_events (idempotency_key)`,
    `CREATE TABLE IF NOT EXISTS email_deliveries (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      to_email TEXT NOT NULL,
      template_key TEXT NOT NULL,
      subject TEXT NOT NULL,
      body_text TEXT NOT NULL,
      status TEXT NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TEXT,
      provider_message_id TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      sent_at TEXT
    )`,
    `ALTER TABLE email_deliveries ADD COLUMN IF NOT EXISTS event_id TEXT`,
    `ALTER TABLE email_deliveries ADD COLUMN IF NOT EXISTS to_email TEXT`,
    `ALTER TABLE email_deliveries ADD COLUMN IF NOT EXISTS template_key TEXT`,
    `ALTER TABLE email_deliveries ADD COLUMN IF NOT EXISTS subject TEXT`,
    `ALTER TABLE email_deliveries ADD COLUMN IF NOT EXISTS body_text TEXT`,
    `ALTER TABLE email_deliveries ADD COLUMN IF NOT EXISTS status TEXT`,
    `ALTER TABLE email_deliveries ADD COLUMN IF NOT EXISTS attempt_count INTEGER`,
    `ALTER TABLE email_deliveries ADD COLUMN IF NOT EXISTS next_attempt_at TEXT`,
    `ALTER TABLE email_deliveries ADD COLUMN IF NOT EXISTS provider_message_id TEXT`,
    `ALTER TABLE email_deliveries ADD COLUMN IF NOT EXISTS last_error TEXT`,
    `ALTER TABLE email_deliveries ADD COLUMN IF NOT EXISTS created_at TEXT`,
    `ALTER TABLE email_deliveries ADD COLUMN IF NOT EXISTS updated_at TEXT`,
    `ALTER TABLE email_deliveries ADD COLUMN IF NOT EXISTS sent_at TEXT`,
    `CREATE INDEX IF NOT EXISTS email_deliveries_status_next_attempt_idx
      ON email_deliveries (status, next_attempt_at)`,
    `ALTER TABLE orders ADD COLUMN IF NOT EXISTS provider_error TEXT`,
    `ALTER TABLE orders ADD COLUMN IF NOT EXISTS intl_surcharge_minor INTEGER`,
    `ALTER TABLE orders ADD COLUMN IF NOT EXISTS refund_status TEXT`,
    `ALTER TABLE orders ADD COLUMN IF NOT EXISTS refund_amount_minor INTEGER`,
    `ALTER TABLE orders ADD COLUMN IF NOT EXISTS refund_reason TEXT`,
    `ALTER TABLE orders ADD COLUMN IF NOT EXISTS refund_id TEXT`,
    `ALTER TABLE orders ADD COLUMN IF NOT EXISTS refunded_at TEXT`,
    `ALTER TABLE orders ADD COLUMN IF NOT EXISTS refund_error_message TEXT`,
    `ALTER TABLE oauth_users ADD COLUMN IF NOT EXISTS name TEXT`,
    `ALTER TABLE oauth_users ADD COLUMN IF NOT EXISTS image TEXT`,
    `ALTER TABLE oauth_users ADD COLUMN IF NOT EXISTS provider TEXT`,
    `ALTER TABLE oauth_users ADD COLUMN IF NOT EXISTS first_seen_at TEXT`,
    `ALTER TABLE oauth_users ADD COLUMN IF NOT EXISTS last_seen_at TEXT`
  ];

  for (const statement of migrationStatements) {
    await db.query(statement);
  }

  try {
    const legacyAiAccounts = await db.query<{
      id: string;
      api_key: string | null;
      api_key_hash: string | null;
      api_key_prefix: string | null;
    }>(
      `SELECT id, api_key, api_key_hash, api_key_prefix
       FROM ai_accounts
       WHERE deleted_at IS NULL`
    );
    for (const account of legacyAiAccounts.rows) {
      const rawKey = (account.api_key || "").trim();
      if (!rawKey) continue;
      if (account.api_key_hash && account.api_key_prefix) continue;
      await db.query(
        `UPDATE ai_accounts
         SET api_key_hash = COALESCE(api_key_hash, ?),
             api_key_prefix = COALESCE(api_key_prefix, ?),
             api_key = ''
         WHERE id = ?`,
        [hashAiApiKeyForStorage(rawKey), deriveAiApiKeyPrefix(rawKey), account.id]
      );
    }
  } catch (error) {
    console.warn("ai_accounts legacy key migration skipped (postgres)", error);
  }

  await db.query(
    `UPDATE humans
     SET api_access_status = COALESCE(NULLIF(api_access_status, ''), 'active'),
         api_monthly_limit = COALESCE(api_monthly_limit, 1000)`
  );
  await db.query(
    `UPDATE ai_accounts
     SET api_access_status = COALESCE(NULLIF(api_access_status, ''), 'active'),
         api_monthly_limit = COALESCE(api_monthly_limit, 50000),
         api_burst_per_minute = COALESCE(api_burst_per_minute, 60)`
  );
  await db.query(
    `UPDATE task_reviews
     SET is_hidden = COALESCE(is_hidden, 0)`
  );
  await db.query(
    `UPDATE human_notification_settings
     SET email_enabled = COALESCE(email_enabled, 1),
         notify_task_accepted = COALESCE(notify_task_accepted, 1),
         notify_ai_message = COALESCE(notify_ai_message, 1),
         created_at = COALESCE(created_at, ?),
         updated_at = COALESCE(updated_at, ?)`
    ,
    [new Date().toISOString(), new Date().toISOString()]
  );
}

async function initSqlite() {
  const db = getSqliteDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS humans (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT,
      paypal_email TEXT,
      stripe_account_id TEXT,
      location TEXT,
      country TEXT NOT NULL,
      min_budget_usd REAL NOT NULL,
      headline TEXT,
      gender TEXT,
      bio TEXT,
      city TEXT,
      region TEXT,
      timezone TEXT,
      hourly_rate_usd REAL,
      skills_json TEXT,
      twitter_url TEXT,
      github_url TEXT,
      instagram_url TEXT,
      linkedin_url TEXT,
      website_url TEXT,
      youtube_url TEXT,
      payout_hold_status TEXT,
      payout_hold_reason TEXT,
      payout_hold_until TEXT,
      api_access_status TEXT NOT NULL DEFAULT 'active',
      api_monthly_limit INTEGER NOT NULL DEFAULT 1000,
      deleted_at TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      paypal_email TEXT NOT NULL,
      api_key TEXT NOT NULL DEFAULT '',
      api_key_hash TEXT,
      api_key_prefix TEXT,
      api_access_status TEXT NOT NULL DEFAULT 'active',
      api_monthly_limit INTEGER NOT NULL DEFAULT 50000,
      api_burst_per_minute INTEGER NOT NULL DEFAULT 60,
      deleted_at TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      task TEXT NOT NULL,
      task_en TEXT,
      location TEXT,
      budget_usd REAL NOT NULL,
      origin_country TEXT,
      task_label TEXT,
      acceptance_criteria TEXT,
      not_allowed TEXT,
      ai_account_id TEXT,
      payer_paypal_email TEXT,
      payee_paypal_email TEXT,
      deliverable TEXT,
      deadline_minutes REAL,
      deadline_at TEXT,
      review_pending_deadline_at TEXT,
      completed_at TEXT,
      review_deadline_at TEXT,
      deleted_at TEXT,
      status TEXT NOT NULL,
      failure_reason TEXT,
      human_id TEXT,
      submission_id TEXT,
      fee_rate REAL,
      fee_amount REAL,
      payout_amount REAL,
      paypal_fee_amount REAL,
      paid_status TEXT,
      approved_at TEXT,
      paid_at TEXT,
      paid_method TEXT,
      payout_batch_id TEXT,
      payment_error_message TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS task_translations (
      task_id TEXT NOT NULL,
      lang TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (task_id, lang)
    );

    CREATE TABLE IF NOT EXISTS submissions (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      type TEXT NOT NULL,
      content_url TEXT,
      text TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS human_photos (
      id TEXT PRIMARY KEY,
      human_id TEXT NOT NULL,
      photo_url TEXT NOT NULL,
      is_public INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS human_inquiries (
      id TEXT PRIMARY KEY,
      human_id TEXT NOT NULL,
      from_name TEXT,
      from_email TEXT,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS oauth_users (
      email TEXT PRIMARY KEY,
      name TEXT,
      image TEXT,
      provider TEXT NOT NULL DEFAULT 'google',
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS message_templates (
      id TEXT PRIMARY KEY,
      human_id TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS task_contacts (
      task_id TEXT PRIMARY KEY,
      ai_account_id TEXT NOT NULL,
      human_id TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      opened_at TEXT,
      closed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS contact_messages (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      sender_type TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      body TEXT NOT NULL,
      attachment_url TEXT,
      created_at TEXT NOT NULL,
      read_by_ai INTEGER NOT NULL DEFAULT 0,
      read_by_human INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS task_review_guards (
      task_id TEXT PRIMARY KEY,
      ai_account_id TEXT NOT NULL,
      recognized_message_id TEXT,
      recognized_submission_id TEXT,
      has_attachment INTEGER NOT NULL DEFAULT 0,
      attachment_checked INTEGER NOT NULL DEFAULT 0,
      acceptance_checked INTEGER NOT NULL DEFAULT 0,
      final_confirmed INTEGER NOT NULL DEFAULT 0,
      review_note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS task_reviews (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      reviewer_type TEXT NOT NULL,
      reviewer_id TEXT NOT NULL,
      reviewee_type TEXT NOT NULL,
      reviewee_id TEXT NOT NULL,
      rating_overall INTEGER NOT NULL,
      comment TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      published_at TEXT,
      is_hidden INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS task_applications (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      human_id TEXT NOT NULL,
      cover_letter TEXT NOT NULL,
      availability TEXT NOT NULL,
      counter_budget_usd REAL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS task_comments (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      human_id TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS idempotency_keys (
      route TEXT NOT NULL,
      idem_key TEXT NOT NULL,
      ai_account_id TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      status_code INTEGER,
      response_body TEXT,
      created_at TEXT NOT NULL,
      PRIMARY KEY (route, idem_key, ai_account_id)
    );

    CREATE TABLE IF NOT EXISTS webhook_endpoints (
      id TEXT PRIMARY KEY,
      ai_account_id TEXT NOT NULL,
      url TEXT NOT NULL,
      secret TEXT NOT NULL,
      status TEXT NOT NULL,
      events TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS webhook_deliveries (
      id TEXT PRIMARY KEY,
      webhook_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      task_id TEXT NOT NULL,
      status_code INTEGER,
      response_body TEXT,
      error TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS human_api_keys (
      id TEXT PRIMARY KEY,
      human_id TEXT NOT NULL,
      name TEXT NOT NULL,
      key_prefix TEXT NOT NULL,
      key_hash TEXT NOT NULL,
      scopes_json TEXT NOT NULL,
      status TEXT NOT NULL,
      last_used_at TEXT,
      expires_at TEXT,
      revoked_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS human_api_usage_monthly (
      human_id TEXT NOT NULL,
      period_key TEXT NOT NULL,
      request_count INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (human_id, period_key)
    );

    CREATE TABLE IF NOT EXISTS human_api_usage_alerts (
      human_id TEXT NOT NULL,
      period_key TEXT NOT NULL,
      threshold_percent INTEGER NOT NULL,
      notified_at TEXT NOT NULL,
      PRIMARY KEY (human_id, period_key, threshold_percent)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS human_api_keys_key_hash_idx ON human_api_keys (key_hash);
    CREATE INDEX IF NOT EXISTS human_api_keys_human_status_idx ON human_api_keys (human_id, status);

    CREATE TABLE IF NOT EXISTS ai_api_usage_monthly (
      ai_account_id TEXT NOT NULL,
      period_key TEXT NOT NULL,
      request_count INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (ai_account_id, period_key)
    );

    CREATE TABLE IF NOT EXISTS ai_api_usage_minute (
      ai_account_id TEXT NOT NULL,
      bucket_key TEXT NOT NULL,
      request_count INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (ai_account_id, bucket_key)
    );

    CREATE TABLE IF NOT EXISTS ai_api_usage_alerts (
      ai_account_id TEXT NOT NULL,
      period_key TEXT NOT NULL,
      threshold_percent INTEGER NOT NULL,
      notified_at TEXT NOT NULL,
      PRIMARY KEY (ai_account_id, period_key, threshold_percent)
    );
    CREATE TABLE IF NOT EXISTS human_notification_settings (
      human_id TEXT PRIMARY KEY,
      email_enabled INTEGER NOT NULL DEFAULT 1,
      notify_task_accepted INTEGER NOT NULL DEFAULT 1,
      notify_ai_message INTEGER NOT NULL DEFAULT 1,
      quiet_hours_start TEXT,
      quiet_hours_end TEXT,
      timezone TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS notification_events (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      task_id TEXT NOT NULL,
      human_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      payload_json TEXT,
      created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS notification_events_idempotency_idx
      ON notification_events (idempotency_key);
    CREATE TABLE IF NOT EXISTS email_deliveries (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      to_email TEXT NOT NULL,
      template_key TEXT NOT NULL,
      subject TEXT NOT NULL,
      body_text TEXT NOT NULL,
      status TEXT NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TEXT,
      provider_message_id TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      sent_at TEXT
    );
    CREATE INDEX IF NOT EXISTS email_deliveries_status_next_attempt_idx
      ON email_deliveries (status, next_attempt_at);
    CREATE UNIQUE INDEX IF NOT EXISTS task_reviews_task_reviewer_idx
      ON task_reviews (task_id, reviewer_type);
    CREATE INDEX IF NOT EXISTS task_reviews_reviewee_published_idx
      ON task_reviews (reviewee_type, reviewee_id, published_at);

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT NOT NULL,
      version INTEGER NOT NULL,
      payment_flow TEXT NOT NULL,
      status TEXT NOT NULL,
      currency TEXT NOT NULL,
      base_amount_jpy INTEGER NOT NULL,
      fx_cost_jpy INTEGER NOT NULL,
      total_amount_jpy INTEGER NOT NULL,
      platform_fee_jpy INTEGER NOT NULL,
      intl_surcharge_minor INTEGER,
      payer_country TEXT NOT NULL,
      payee_country TEXT NOT NULL,
      is_international INTEGER NOT NULL,
      destination_account_id TEXT NOT NULL,
      human_id TEXT,
      task_id TEXT,
      checkout_session_id TEXT,
      payment_intent_id TEXT,
      charge_id TEXT,
      refund_status TEXT,
      refund_amount_minor INTEGER,
      refund_reason TEXT,
      refund_id TEXT,
      refunded_at TEXT,
      refund_error_message TEXT,
      mismatch_reason TEXT,
      provider_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (id, version)
    );

    CREATE TABLE IF NOT EXISTS stripe_webhook_events (
      event_id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      event_created INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      received_at TEXT NOT NULL,
      status TEXT NOT NULL,
      processing_started_at TEXT,
      processed_at TEXT,
      processing_error TEXT
    );
  `);

  ensureSqliteColumn(db, "tasks", "task_en", "TEXT");
  ensureSqliteColumn(db, "tasks", "origin_country", "TEXT");
  ensureSqliteColumn(db, "tasks", "task_label", "TEXT");
  ensureSqliteColumn(db, "tasks", "acceptance_criteria", "TEXT");
  ensureSqliteColumn(db, "tasks", "not_allowed", "TEXT");
  ensureSqliteColumn(db, "tasks", "ai_account_id", "TEXT");
  ensureSqliteColumn(db, "tasks", "payer_paypal_email", "TEXT");
  ensureSqliteColumn(db, "tasks", "payee_paypal_email", "TEXT");
  ensureSqliteColumn(db, "tasks", "deadline_at", "TEXT");
  ensureSqliteColumn(db, "tasks", "review_pending_deadline_at", "TEXT");
  ensureSqliteColumn(db, "tasks", "completed_at", "TEXT");
  ensureSqliteColumn(db, "tasks", "review_deadline_at", "TEXT");
  ensureSqliteColumn(db, "tasks", "deleted_at", "TEXT");
  ensureSqliteColumn(db, "tasks", "failure_reason", "TEXT");
  ensureSqliteColumn(db, "tasks", "submission_id", "TEXT");
  ensureSqliteColumn(db, "tasks", "fee_rate", "REAL");
  ensureSqliteColumn(db, "tasks", "fee_amount", "REAL");
  ensureSqliteColumn(db, "tasks", "payout_amount", "REAL");
  ensureSqliteColumn(db, "tasks", "paypal_fee_amount", "REAL");
  ensureSqliteColumn(db, "tasks", "paid_status", "TEXT");
  ensureSqliteColumn(db, "tasks", "approved_at", "TEXT");
  ensureSqliteColumn(db, "tasks", "paid_at", "TEXT");
  ensureSqliteColumn(db, "tasks", "paid_method", "TEXT");
  ensureSqliteColumn(db, "tasks", "payout_batch_id", "TEXT");
  ensureSqliteColumn(db, "tasks", "payment_error_message", "TEXT");
  ensureSqliteColumn(db, "humans", "email", "TEXT");
  ensureSqliteColumn(db, "humans", "paypal_email", "TEXT");
  ensureSqliteColumn(db, "humans", "stripe_account_id", "TEXT");
  ensureSqliteColumn(db, "humans", "country", "TEXT");
  ensureSqliteColumn(db, "humans", "headline", "TEXT");
  ensureSqliteColumn(db, "humans", "gender", "TEXT");
  ensureSqliteColumn(db, "humans", "bio", "TEXT");
  ensureSqliteColumn(db, "humans", "city", "TEXT");
  ensureSqliteColumn(db, "humans", "region", "TEXT");
  ensureSqliteColumn(db, "humans", "timezone", "TEXT");
  ensureSqliteColumn(db, "humans", "hourly_rate_usd", "REAL");
  ensureSqliteColumn(db, "humans", "skills_json", "TEXT");
  ensureSqliteColumn(db, "humans", "twitter_url", "TEXT");
  ensureSqliteColumn(db, "humans", "github_url", "TEXT");
  ensureSqliteColumn(db, "humans", "instagram_url", "TEXT");
  ensureSqliteColumn(db, "humans", "linkedin_url", "TEXT");
  ensureSqliteColumn(db, "humans", "website_url", "TEXT");
  ensureSqliteColumn(db, "humans", "youtube_url", "TEXT");
  ensureSqliteColumn(db, "humans", "payout_hold_status", "TEXT");
  ensureSqliteColumn(db, "humans", "payout_hold_reason", "TEXT");
  ensureSqliteColumn(db, "humans", "payout_hold_until", "TEXT");
  ensureSqliteColumn(db, "humans", "api_access_status", "TEXT");
  ensureSqliteColumn(db, "humans", "api_monthly_limit", "INTEGER");
  ensureSqliteColumn(db, "humans", "deleted_at", "TEXT");
  ensureSqliteColumn(db, "ai_accounts", "deleted_at", "TEXT");
  ensureSqliteColumn(db, "ai_accounts", "api_key_hash", "TEXT");
  ensureSqliteColumn(db, "ai_accounts", "api_key_prefix", "TEXT");
  ensureSqliteColumn(db, "ai_accounts", "api_access_status", "TEXT");
  ensureSqliteColumn(db, "ai_accounts", "api_monthly_limit", "INTEGER");
  ensureSqliteColumn(db, "ai_accounts", "api_burst_per_minute", "INTEGER");
  ensureSqliteColumn(db, "idempotency_keys", "status_code", "INTEGER");
  ensureSqliteColumn(db, "idempotency_keys", "response_body", "TEXT");
  ensureSqliteColumn(db, "webhook_endpoints", "events", "TEXT");
  ensureSqliteColumn(db, "webhook_deliveries", "status_code", "INTEGER");
  ensureSqliteColumn(db, "webhook_deliveries", "response_body", "TEXT");
  ensureSqliteColumn(db, "webhook_deliveries", "error", "TEXT");
  ensureSqliteColumn(db, "oauth_users", "name", "TEXT");
  ensureSqliteColumn(db, "oauth_users", "image", "TEXT");
  ensureSqliteColumn(db, "oauth_users", "provider", "TEXT");
  ensureSqliteColumn(db, "oauth_users", "first_seen_at", "TEXT");
  ensureSqliteColumn(db, "oauth_users", "last_seen_at", "TEXT");
  ensureSqliteColumn(db, "human_notification_settings", "email_enabled", "INTEGER");
  ensureSqliteColumn(db, "human_notification_settings", "notify_task_accepted", "INTEGER");
  ensureSqliteColumn(db, "human_notification_settings", "notify_ai_message", "INTEGER");
  ensureSqliteColumn(db, "human_notification_settings", "quiet_hours_start", "TEXT");
  ensureSqliteColumn(db, "human_notification_settings", "quiet_hours_end", "TEXT");
  ensureSqliteColumn(db, "human_notification_settings", "timezone", "TEXT");
  ensureSqliteColumn(db, "human_notification_settings", "created_at", "TEXT");
  ensureSqliteColumn(db, "human_notification_settings", "updated_at", "TEXT");
  ensureSqliteColumn(db, "notification_events", "event_type", "TEXT");
  ensureSqliteColumn(db, "notification_events", "task_id", "TEXT");
  ensureSqliteColumn(db, "notification_events", "human_id", "TEXT");
  ensureSqliteColumn(db, "notification_events", "idempotency_key", "TEXT");
  ensureSqliteColumn(db, "notification_events", "payload_json", "TEXT");
  ensureSqliteColumn(db, "notification_events", "created_at", "TEXT");
  ensureSqliteColumn(db, "email_deliveries", "event_id", "TEXT");
  ensureSqliteColumn(db, "email_deliveries", "to_email", "TEXT");
  ensureSqliteColumn(db, "email_deliveries", "template_key", "TEXT");
  ensureSqliteColumn(db, "email_deliveries", "subject", "TEXT");
  ensureSqliteColumn(db, "email_deliveries", "body_text", "TEXT");
  ensureSqliteColumn(db, "email_deliveries", "status", "TEXT");
  ensureSqliteColumn(db, "email_deliveries", "attempt_count", "INTEGER");
  ensureSqliteColumn(db, "email_deliveries", "next_attempt_at", "TEXT");
  ensureSqliteColumn(db, "email_deliveries", "provider_message_id", "TEXT");
  ensureSqliteColumn(db, "email_deliveries", "last_error", "TEXT");
  ensureSqliteColumn(db, "email_deliveries", "created_at", "TEXT");
  ensureSqliteColumn(db, "email_deliveries", "updated_at", "TEXT");
  ensureSqliteColumn(db, "email_deliveries", "sent_at", "TEXT");
  ensureSqliteColumn(db, "human_photos", "is_public", "INTEGER");
  ensureSqliteColumn(db, "human_inquiries", "is_read", "INTEGER");
  ensureSqliteColumn(db, "message_templates", "updated_at", "TEXT");
  ensureSqliteColumn(db, "task_contacts", "opened_at", "TEXT");
  ensureSqliteColumn(db, "task_contacts", "closed_at", "TEXT");
  ensureSqliteColumn(db, "contact_messages", "attachment_url", "TEXT");
  ensureSqliteColumn(db, "contact_messages", "read_by_ai", "INTEGER");
  ensureSqliteColumn(db, "contact_messages", "read_by_human", "INTEGER");
  ensureSqliteColumn(db, "task_review_guards", "recognized_message_id", "TEXT");
  ensureSqliteColumn(db, "task_review_guards", "recognized_submission_id", "TEXT");
  ensureSqliteColumn(db, "task_review_guards", "has_attachment", "INTEGER");
  ensureSqliteColumn(db, "task_review_guards", "attachment_checked", "INTEGER");
  ensureSqliteColumn(db, "task_review_guards", "acceptance_checked", "INTEGER");
  ensureSqliteColumn(db, "task_review_guards", "final_confirmed", "INTEGER");
  ensureSqliteColumn(db, "task_review_guards", "review_note", "TEXT");
  ensureSqliteColumn(db, "task_review_guards", "created_at", "TEXT");
  ensureSqliteColumn(db, "task_review_guards", "updated_at", "TEXT");
  ensureSqliteColumn(db, "task_reviews", "task_id", "TEXT");
  ensureSqliteColumn(db, "task_reviews", "reviewer_type", "TEXT");
  ensureSqliteColumn(db, "task_reviews", "reviewer_id", "TEXT");
  ensureSqliteColumn(db, "task_reviews", "reviewee_type", "TEXT");
  ensureSqliteColumn(db, "task_reviews", "reviewee_id", "TEXT");
  ensureSqliteColumn(db, "task_reviews", "rating_overall", "INTEGER");
  ensureSqliteColumn(db, "task_reviews", "comment", "TEXT");
  ensureSqliteColumn(db, "task_reviews", "created_at", "TEXT");
  ensureSqliteColumn(db, "task_reviews", "updated_at", "TEXT");
  ensureSqliteColumn(db, "task_reviews", "published_at", "TEXT");
  ensureSqliteColumn(db, "task_reviews", "is_hidden", "INTEGER");
  ensureSqliteColumn(db, "orders", "provider_error", "TEXT");
  ensureSqliteColumn(db, "orders", "intl_surcharge_minor", "INTEGER");
  ensureSqliteColumn(db, "orders", "refund_status", "TEXT");
  ensureSqliteColumn(db, "orders", "refund_amount_minor", "INTEGER");
  ensureSqliteColumn(db, "orders", "refund_reason", "TEXT");
  ensureSqliteColumn(db, "orders", "refund_id", "TEXT");
  ensureSqliteColumn(db, "orders", "refunded_at", "TEXT");
  ensureSqliteColumn(db, "orders", "refund_error_message", "TEXT");

  try {
    const legacyAiAccounts = db
      .prepare(
        `SELECT id, api_key, api_key_hash, api_key_prefix
         FROM ai_accounts
         WHERE deleted_at IS NULL`
      )
      .all() as Array<{
      id: string;
      api_key: string | null;
      api_key_hash: string | null;
      api_key_prefix: string | null;
    }>;
    const updateAiKeyStmt = db.prepare(
      `UPDATE ai_accounts
       SET api_key_hash = COALESCE(api_key_hash, ?),
           api_key_prefix = COALESCE(api_key_prefix, ?),
           api_key = ''
       WHERE id = ?`
    );
    for (const account of legacyAiAccounts) {
      const rawKey = (account.api_key || "").trim();
      if (!rawKey) continue;
      if (account.api_key_hash && account.api_key_prefix) continue;
      updateAiKeyStmt.run(
        hashAiApiKeyForStorage(rawKey),
        deriveAiApiKeyPrefix(rawKey),
        account.id
      );
    }
  } catch (error) {
    console.warn("ai_accounts legacy key migration skipped (sqlite)", error);
  }

  db.exec(
    `UPDATE humans
     SET api_access_status = COALESCE(NULLIF(api_access_status, ''), 'active'),
         api_monthly_limit = COALESCE(api_monthly_limit, 1000)`
  );
  db.exec(
    `UPDATE ai_accounts
     SET api_access_status = COALESCE(NULLIF(api_access_status, ''), 'active'),
         api_monthly_limit = COALESCE(api_monthly_limit, 50000),
         api_burst_per_minute = COALESCE(api_burst_per_minute, 60)`
  );
  db.exec(
    `UPDATE task_reviews
     SET is_hidden = COALESCE(is_hidden, 0)`
  );
  db.exec(
    `UPDATE human_notification_settings
     SET email_enabled = COALESCE(email_enabled, 1),
         notify_task_accepted = COALESCE(notify_task_accepted, 1),
         notify_ai_message = COALESCE(notify_ai_message, 1)`
  );
}

async function ensureInit() {
  if (!mode) {
    mode = resolveMode();
  }
  if (!initPromise) {
    initPromise = mode === "postgres" ? initPostgres() : initSqlite();
  }
  await initPromise;
  if (!sweeperStarted && client) {
    sweeperStarted = true;
    startTimeoutSweeper(client);
  }
}

function buildPostgresClient(): DbClient {
  return {
    prepare: (sql: string) => {
      const pgSql = toPgSql(sql);
      return {
        get: async <T = any>(...params: Array<string | number | null>) => {
          await ensureInit();
          const result = await getPool().query<T>(pgSql, params);
          return result.rows[0];
        },
        all: async <T = any>(...params: Array<string | number | null>) => {
          await ensureInit();
          const result = await getPool().query<T>(pgSql, params);
          return result.rows;
        },
        run: async (...params: Array<string | number | null>) => {
          await ensureInit();
          const result = await getPool().query(pgSql, params);
          return result.rowCount ?? 0;
        }
      };
    },
    query: async <T = any>(sql: string, params?: Array<string | number | null>) => {
      await ensureInit();
      const result = await getPool().query<T>(toPgSql(sql), params);
      return { rows: result.rows, rowCount: result.rowCount ?? 0 };
    }
  };
}

function buildSqliteClient(): DbClient {
  return {
    prepare: (sql: string) => {
      return {
        get: async <T = any>(...params: Array<string | number | null>) => {
          await ensureInit();
          const stmt = getSqliteDb().prepare(sql);
          return stmt.get(...params) as T | undefined;
        },
        all: async <T = any>(...params: Array<string | number | null>) => {
          await ensureInit();
          const stmt = getSqliteDb().prepare(sql);
          return stmt.all(...params) as T[];
        },
        run: async (...params: Array<string | number | null>) => {
          await ensureInit();
          const stmt = getSqliteDb().prepare(sql);
          const result = stmt.run(...params);
          return result.changes;
        }
      };
    },
    query: async <T = any>(sql: string, params?: Array<string | number | null>) => {
      await ensureInit();
      const stmt = getSqliteDb().prepare(sql);
      if (stmt.reader) {
        const rows = stmt.all(...(params ?? [])) as T[];
        return { rows, rowCount: rows.length };
      }
      const info = stmt.run(...(params ?? []));
      return { rows: [], rowCount: info.changes };
    }
  };
}

export function getDb(): DbClient {
  if (client) return client;
  mode = resolveMode();
  client = mode === "postgres" ? buildPostgresClient() : buildSqliteClient();
  return client;
}

export type Human = {
  id: string;
  name: string;
  email: string | null;
  paypal_email: string | null;
  stripe_account_id: string | null;
  location: string | null;
  country: string | null;
  payout_hold_status: "none" | "active" | null;
  payout_hold_reason: string | null;
  payout_hold_until: string | null;
  min_budget_usd: number;
  status: "available" | "busy";
  created_at: string;
};

export type Order = {
  id: string;
  version: number;
  payment_flow: "checkout";
  status:
    | "created"
    | "checkout_created"
    | "paid"
    | "partially_refunded"
    | "refunded"
    | "failed_mismatch"
    | "failed_provider"
    | "canceled";
  currency: "jpy";
  base_amount_jpy: number;
  fx_cost_jpy: number;
  total_amount_jpy: number;
  platform_fee_jpy: number;
  payer_country: "JP" | "US";
  payee_country: "JP" | "US";
  is_international: 0 | 1;
  destination_account_id: string;
  human_id: string | null;
  task_id: string | null;
  checkout_session_id: string | null;
  payment_intent_id: string | null;
  charge_id: string | null;
  refund_status: "none" | "partial" | "full" | "failed" | null;
  refund_amount_minor: number | null;
  refund_reason: "duplicate" | "fraudulent" | "requested_by_customer" | null;
  refund_id: string | null;
  refunded_at: string | null;
  refund_error_message: string | null;
  mismatch_reason: string | null;
  provider_error: string | null;
  created_at: string;
  updated_at: string;
};

export type StripeWebhookEventRow = {
  event_id: string;
  event_type: string;
  event_created: number;
  payload_json: string;
  received_at: string;
  status: "pending" | "processing" | "processed" | "failed";
  processing_started_at: string | null;
  processed_at: string | null;
  processing_error: string | null;
};

// Task lifecycle:
// open -> accepted -> review_pending -> completed
// open -> failed
// accepted -> failed
export type FailureReason =
  | "no_human_available"
  | "timeout"
  | "invalid_request"
  | "below_min_budget"
  | "missing_origin_country"
  | "wrong_deliverable"
  | "already_assigned"
  | "not_assigned"
  | "requester_rejected"
  | "missing_human"
  | "not_found"
  | "unknown";

export type Task = {
  id: string;
  task: string;
  task_en: string | null;
  location: string | null;
  budget_usd: number;
  origin_country: string | null;
  task_label: TaskLabel | null;
  acceptance_criteria: string | null;
  not_allowed: string | null;
  ai_account_id: string | null;
  payer_paypal_email: string | null;
  payee_paypal_email: string | null;
  deliverable: "photo" | "video" | "text" | null;
  deadline_minutes: number | null;
  deadline_at: string | null;
  review_pending_deadline_at: string | null;
  completed_at: string | null;
  review_deadline_at: string | null;
  status: "open" | "accepted" | "review_pending" | "completed" | "failed";
  failure_reason: FailureReason | null;
  human_id: string | null;
  submission_id: string | null;
  fee_rate: number | null;
  fee_amount: number | null;
  payout_amount: number | null;
  paypal_fee_amount: number | null;
  paid_status: "unpaid" | "pending" | "approved" | "paid" | "failed" | null;
  approved_at: string | null;
  paid_at: string | null;
  paid_method: "paypal" | "stripe" | null;
  payout_batch_id: string | null;
  payment_error_message: string | null;
  created_at: string;
};

export type AiAccount = {
  id: string;
  name: string;
  paypal_email: string;
  api_key: string;
  api_key_hash: string | null;
  api_key_prefix: string | null;
  status: "active" | "disabled";
  created_at: string;
};

export type Submission = {
  id: string;
  task_id: string;
  type: "photo" | "video" | "text";
  content_url: string | null;
  text: string | null;
  created_at: string;
};

export type HumanPhoto = {
  id: string;
  human_id: string;
  photo_url: string;
  is_public: 0 | 1;
  created_at: string;
};

export type HumanInquiry = {
  id: string;
  human_id: string;
  from_name: string | null;
  from_email: string | null;
  subject: string;
  body: string;
  is_read: 0 | 1;
  created_at: string;
};

export type MessageTemplate = {
  id: string;
  human_id: string;
  title: string;
  body: string;
  created_at: string;
  updated_at: string;
};

export type TaskContact = {
  task_id: string;
  ai_account_id: string;
  human_id: string;
  status: "pending" | "open" | "closed";
  created_at: string;
  opened_at: string | null;
  closed_at: string | null;
};

export type ContactMessage = {
  id: string;
  task_id: string;
  sender_type: "ai" | "human";
  sender_id: string;
  body: string;
  attachment_url: string | null;
  created_at: string;
  read_by_ai: 0 | 1;
  read_by_human: 0 | 1;
};

export type TaskReviewGuard = {
  task_id: string;
  ai_account_id: string;
  recognized_message_id: string | null;
  recognized_submission_id: string | null;
  has_attachment: 0 | 1;
  attachment_checked: 0 | 1;
  acceptance_checked: 0 | 1;
  final_confirmed: 0 | 1;
  review_note: string | null;
  created_at: string;
  updated_at: string;
};

export type TaskReview = {
  id: string;
  task_id: string;
  reviewer_type: "ai" | "human";
  reviewer_id: string;
  reviewee_type: "ai" | "human";
  reviewee_id: string;
  rating_overall: number;
  comment: string | null;
  created_at: string;
  updated_at: string;
  published_at: string | null;
  is_hidden: 0 | 1;
};

export type HumanNotificationSettings = {
  human_id: string;
  email_enabled: 0 | 1;
  notify_task_accepted: 0 | 1;
  notify_ai_message: 0 | 1;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  timezone: string | null;
  created_at: string;
  updated_at: string;
};
