import fs from "fs";
import path from "path";
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
      deleted_at TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS ai_accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      paypal_email TEXT NOT NULL,
      api_key TEXT NOT NULL,
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
      payer_country TEXT NOT NULL,
      payee_country TEXT NOT NULL,
      is_international INTEGER NOT NULL,
      destination_account_id TEXT NOT NULL,
      human_id TEXT,
      task_id TEXT,
      checkout_session_id TEXT,
      payment_intent_id TEXT,
      charge_id TEXT,
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
    )`
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
    `ALTER TABLE humans ADD COLUMN IF NOT EXISTS deleted_at TEXT`,
    `ALTER TABLE ai_accounts ADD COLUMN IF NOT EXISTS deleted_at TEXT`,
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
    `ALTER TABLE idempotency_keys ADD COLUMN IF NOT EXISTS status_code INTEGER`,
    `ALTER TABLE idempotency_keys ADD COLUMN IF NOT EXISTS response_body TEXT`,
    `ALTER TABLE webhook_endpoints ADD COLUMN IF NOT EXISTS events TEXT`,
    `ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS status_code INTEGER`,
    `ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS response_body TEXT`,
    `ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS error TEXT`,
    `ALTER TABLE orders ADD COLUMN IF NOT EXISTS provider_error TEXT`
  ];

  for (const statement of migrationStatements) {
    await db.query(statement);
  }
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
      deleted_at TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      paypal_email TEXT NOT NULL,
      api_key TEXT NOT NULL,
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
      payer_country TEXT NOT NULL,
      payee_country TEXT NOT NULL,
      is_international INTEGER NOT NULL,
      destination_account_id TEXT NOT NULL,
      human_id TEXT,
      task_id TEXT,
      checkout_session_id TEXT,
      payment_intent_id TEXT,
      charge_id TEXT,
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
  ensureSqliteColumn(db, "humans", "deleted_at", "TEXT");
  ensureSqliteColumn(db, "ai_accounts", "deleted_at", "TEXT");
  ensureSqliteColumn(db, "idempotency_keys", "status_code", "INTEGER");
  ensureSqliteColumn(db, "idempotency_keys", "response_body", "TEXT");
  ensureSqliteColumn(db, "webhook_endpoints", "events", "TEXT");
  ensureSqliteColumn(db, "webhook_deliveries", "status_code", "INTEGER");
  ensureSqliteColumn(db, "webhook_deliveries", "response_body", "TEXT");
  ensureSqliteColumn(db, "webhook_deliveries", "error", "TEXT");
  ensureSqliteColumn(db, "human_photos", "is_public", "INTEGER");
  ensureSqliteColumn(db, "human_inquiries", "is_read", "INTEGER");
  ensureSqliteColumn(db, "message_templates", "updated_at", "TEXT");
  ensureSqliteColumn(db, "task_contacts", "opened_at", "TEXT");
  ensureSqliteColumn(db, "task_contacts", "closed_at", "TEXT");
  ensureSqliteColumn(db, "contact_messages", "attachment_url", "TEXT");
  ensureSqliteColumn(db, "contact_messages", "read_by_ai", "INTEGER");
  ensureSqliteColumn(db, "contact_messages", "read_by_human", "INTEGER");
  ensureSqliteColumn(db, "orders", "provider_error", "TEXT");
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
// open -> accepted -> completed
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
  status: "open" | "accepted" | "completed" | "failed";
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
  paid_method: "paypal" | null;
  payout_batch_id: string | null;
  payment_error_message: string | null;
  created_at: string;
};

export type AiAccount = {
  id: string;
  name: string;
  paypal_email: string;
  api_key: string;
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
