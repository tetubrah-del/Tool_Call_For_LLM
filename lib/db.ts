import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { startTimeoutSweeper } from "@/lib/timeout-sweeper";

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
      location TEXT,
      min_budget_usd REAL NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      task TEXT NOT NULL,
      task_en TEXT,
      location TEXT,
      budget_usd REAL NOT NULL,
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
  `);

  ensureColumn(instance, "tasks", "task_en", "TEXT");
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
  location: string | null;
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

export type Submission = {
  id: string;
  task_id: string;
  type: "photo" | "video" | "text";
  content_url: string | null;
  text: string | null;
  created_at: string;
};
