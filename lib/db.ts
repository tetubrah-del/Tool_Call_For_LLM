import fs from "fs";
import path from "path";
import Database from "better-sqlite3";

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
      location TEXT,
      budget_usd REAL NOT NULL,
      deliverable TEXT,
      deadline_minutes REAL,
      status TEXT NOT NULL,
      human_id TEXT,
      created_at TEXT NOT NULL
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

  db = instance;
  return db;
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

export type Task = {
  id: string;
  task: string;
  location: string | null;
  budget_usd: number;
  deliverable: "photo" | "video" | "text" | null;
  deadline_minutes: number | null;
  status: "open" | "accepted" | "completed" | "failed";
  human_id: string | null;
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
