import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { startTimeoutSweeper } from "@/lib/timeout-sweeper";
import type { TaskLabel } from "@/lib/task-labels";

const DB_PATH = path.join(process.cwd(), "data", "app.db");

let db: Database.Database | null = null;

function ensureDb() {
  if (db) return db;

  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const instance = new Database(DB_PATH);
  instance.pragma("journal_mode = WAL");

  instance.exec(`
    CREATE TABLE IF NOT EXISTS humans (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT,
      paypal_email TEXT,
      location TEXT,
      country TEXT NOT NULL,
      min_budget_usd REAL NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      paypal_email TEXT NOT NULL,
      api_key TEXT NOT NULL,
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
      status TEXT NOT NULL,
      failure_reason TEXT,
      human_id TEXT,
      submission_id TEXT,
      fee_rate REAL,
      fee_amount REAL,
      payout_amount REAL,
      paypal_fee_amount REAL,
      paid_status TEXT,
      paid_at TEXT,
      paid_method TEXT,
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

    CREATE TABLE IF NOT EXISTS idempotency_keys (
      route TEXT NOT NULL,
      idem_key TEXT NOT NULL,
      ai_account_id TEXT,
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
  `);

  ensureColumn(instance, "tasks", "task_en", "TEXT");
  ensureColumn(instance, "tasks", "origin_country", "TEXT");
  ensureColumn(instance, "tasks", "task_label", "TEXT");
  ensureColumn(instance, "tasks", "acceptance_criteria", "TEXT");
  ensureColumn(instance, "tasks", "not_allowed", "TEXT");
  ensureColumn(instance, "tasks", "ai_account_id", "TEXT");
  ensureColumn(instance, "tasks", "payer_paypal_email", "TEXT");
  ensureColumn(instance, "tasks", "payee_paypal_email", "TEXT");
  ensureColumn(instance, "tasks", "deadline_at", "TEXT");
  ensureColumn(instance, "tasks", "failure_reason", "TEXT");
  ensureColumn(instance, "tasks", "submission_id", "TEXT");
  ensureColumn(instance, "tasks", "fee_rate", "REAL");
  ensureColumn(instance, "tasks", "fee_amount", "REAL");
  ensureColumn(instance, "tasks", "payout_amount", "REAL");
  ensureColumn(instance, "tasks", "paypal_fee_amount", "REAL");
  ensureColumn(instance, "tasks", "paid_status", "TEXT");
  ensureColumn(instance, "tasks", "paid_at", "TEXT");
  ensureColumn(instance, "tasks", "paid_method", "TEXT");
  ensureColumn(instance, "humans", "email", "TEXT");
  ensureColumn(instance, "humans", "paypal_email", "TEXT");
  ensureColumn(instance, "humans", "country", "TEXT");
  ensureColumn(instance, "idempotency_keys", "status_code", "INTEGER");
  ensureColumn(instance, "idempotency_keys", "response_body", "TEXT");
  ensureColumn(instance, "webhook_endpoints", "events", "TEXT");
  ensureColumn(instance, "webhook_deliveries", "status_code", "INTEGER");
  ensureColumn(instance, "webhook_deliveries", "response_body", "TEXT");
  ensureColumn(instance, "webhook_deliveries", "error", "TEXT");
  ensureColumn(instance, "human_photos", "is_public", "INTEGER");

  startTimeoutSweeper(instance);

  db = instance;
  return db;
}

function ensureColumn(
  instance: Database.Database,
  table: string,
  column: string,
  type: string
) {
  const rows = instance
    .prepare(`PRAGMA table_info(${table})`)
    .all() as Array<{ name: string }>;
  if (rows.some((row) => row.name === column)) return;
  instance.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}

export function getDb() {
  return ensureDb();
}

export type Human = {
  id: string;
  name: string;
  email: string | null;
  paypal_email: string | null;
  location: string | null;
  country: string | null;
  min_budget_usd: number;
  status: "available" | "busy";
  created_at: string;
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
  paid_status: "unpaid" | "paid" | null;
  paid_at: string | null;
  paid_method: "paypal" | null;
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
