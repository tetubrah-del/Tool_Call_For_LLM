import path from "path";
import Database from "better-sqlite3";
import pg from "pg";

const email = (process.argv[2] || "").trim().toLowerCase();
if (!email) {
  console.error("Usage: node scripts/delete-human-by-email.mjs <email>");
  process.exit(2);
}

const DATABASE_URL = (process.env.DATABASE_URL || "").trim();

async function deleteFromPostgres() {
  const pool = new pg.Pool({
    connectionString: DATABASE_URL,
    ssl: DATABASE_URL.toLowerCase().includes("sslmode=require") ? { rejectUnauthorized: false } : undefined
  });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const humans = await client.query(
      "SELECT id, email FROM humans WHERE lower(email) = $1 ORDER BY created_at DESC",
      [email]
    );
    if (humans.rowCount === 0) {
      await client.query("ROLLBACK");
      console.log(JSON.stringify({ status: "not_found", email, db: "postgres" }));
      return;
    }

    const ids = humans.rows.map((r) => r.id);
    const del = async (sql) => (await client.query(sql, [ids])).rowCount || 0;

    const deleted = {
      humans: 0,
      human_photos: 0,
      human_inquiries: 0,
      message_templates: 0,
      task_applications: 0,
      task_comments: 0,
      task_contacts: 0
    };

    deleted.human_photos = await del("DELETE FROM human_photos WHERE human_id = ANY($1)");
    deleted.human_inquiries = await del("DELETE FROM human_inquiries WHERE human_id = ANY($1)");
    deleted.message_templates = await del("DELETE FROM message_templates WHERE human_id = ANY($1)");
    deleted.task_applications = await del("DELETE FROM task_applications WHERE human_id = ANY($1)");
    deleted.task_comments = await del("DELETE FROM task_comments WHERE human_id = ANY($1)");
    deleted.task_contacts = await del("DELETE FROM task_contacts WHERE human_id = ANY($1)");
    deleted.humans = await del("DELETE FROM humans WHERE id = ANY($1)");

    await client.query("COMMIT");
    console.log(
      JSON.stringify(
        { status: "deleted", email, db: "postgres", human_ids: ids, deleted },
        null,
        2
      )
    );
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

function deleteFromSqlite() {
  const dbPath = path.join(process.cwd(), "data", "app.db");
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");

  const humans = db
    .prepare("SELECT id, email FROM humans WHERE lower(email) = ? ORDER BY created_at DESC")
    .all(email);

  if (humans.length === 0) {
    console.log(JSON.stringify({ status: "not_found", email, db: "sqlite", dbPath }));
    return;
  }

  const tx = db.transaction(() => {
    const ids = humans.map((h) => h.id);
    const placeholders = ids.map(() => "?").join(",");

    const del = (sql) => db.prepare(sql).run(...ids).changes;

    const deleted = {
      humans: 0,
      human_photos: 0,
      human_inquiries: 0,
      message_templates: 0,
      task_applications: 0,
      task_comments: 0,
      task_contacts: 0
    };

    deleted.human_photos = del(`DELETE FROM human_photos WHERE human_id IN (${placeholders})`);
    deleted.human_inquiries = del(
      `DELETE FROM human_inquiries WHERE human_id IN (${placeholders})`
    );
    deleted.message_templates = del(
      `DELETE FROM message_templates WHERE human_id IN (${placeholders})`
    );
    deleted.task_applications = del(
      `DELETE FROM task_applications WHERE human_id IN (${placeholders})`
    );
    deleted.task_comments = del(
      `DELETE FROM task_comments WHERE human_id IN (${placeholders})`
    );
    deleted.task_contacts = del(`DELETE FROM task_contacts WHERE human_id IN (${placeholders})`);
    deleted.humans = del(`DELETE FROM humans WHERE id IN (${placeholders})`);

    return deleted;
  });

  const result = tx();
  console.log(
    JSON.stringify(
      {
        status: "deleted",
        email,
        db: "sqlite",
        dbPath,
        human_ids: humans.map((h) => h.id),
        deleted: result
      },
      null,
      2
    )
  );
}

if (DATABASE_URL) {
  await deleteFromPostgres();
} else {
  deleteFromSqlite();
}
