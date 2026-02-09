/**
 * Stripe webhook DB worker (Node.js, ESM)
 *
 * - Polls stripe_webhook_events where status='pending'
 * - Claims rows with optimistic update (status: pending -> processing)
 * - Processes supported events:
 *   - checkout.session.completed
 *   - payment_intent.succeeded
 *   - charge.succeeded
 * - Uses orders DB as source-of-truth and reconciles Stripe fields against DB.
 *
 * ENV:
 * - DATABASE_URL (optional; if unset, uses SQLite at data/app.db)
 * - STRIPE_SECRET_KEY (sk_live_...)
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import Database from "better-sqlite3";
import pg from "pg";
import Stripe from "stripe";

const { Pool } = pg;

const DB_PATH = path.join(process.cwd(), "data", "app.db");
const DATABASE_URL = (process.env.DATABASE_URL || "").trim();
const STRIPE_SECRET_KEY = (process.env.STRIPE_SECRET_KEY || "").trim();

if (!STRIPE_SECRET_KEY || !STRIPE_SECRET_KEY.startsWith("sk_")) {
  throw new Error("STRIPE_SECRET_KEY (sk_...) is required for the worker");
}

const stripe = new Stripe(STRIPE_SECRET_KEY);

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
      sslModeFromUrl === "verify-ca" ||
      sslModeFromUrl === "verify-full" ||
      sslModeFromUrl === "no-verify" ||
      sslFromUrl === "true" ||
      sslFromUrl === "1";
    if (useSsl) {
      parsed.searchParams.delete("sslmode");
      parsed.searchParams.delete("ssl");
      parsed.searchParams.delete("sslcert");
      parsed.searchParams.delete("sslkey");
      parsed.searchParams.delete("sslrootcert");
      connectionString = parsed.toString();
    }
  } catch {
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
      mode: "postgres",
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
    mode: "sqlite",
    async all(sql, params = []) {
      const stmt = db.prepare(sql);
      return stmt.all(...params);
    },
    async run(sql, params = []) {
      const stmt = db.prepare(sql);
      const info = stmt.run(...params);
      return info.changes;
    },
    async close() {
      db.close();
    }
  };
}

function parseOrderKeyFromRef(ref) {
  // client_reference_id format: {orderId}:v{version}
  const text = String(ref || "").trim();
  const m = /^(.+):v(\d+)$/.exec(text);
  if (!m) return null;
  const orderId = m[1];
  const version = Number(m[2]);
  if (!orderId || !Number.isInteger(version) || version <= 0) return null;
  return { orderId, version };
}

function parseOrderKeyFromMetadata(meta) {
  const orderId = typeof meta?.order_id === "string" ? meta.order_id.trim() : "";
  const version = meta?.version == null ? NaN : Number(meta.version);
  if (!orderId || !Number.isInteger(version) || version <= 0) return null;
  return { orderId, version };
}

function computeMismatchReason(mismatches) {
  return JSON.stringify({ mismatches });
}

async function markOrderMismatch(db, orderId, version, reason) {
  await db.run(
    `UPDATE orders
     SET status = 'failed_mismatch',
         mismatch_reason = ?,
         updated_at = ?
     WHERE id = ? AND version = ?`,
    [reason, nowIso(), orderId, version]
  );
}

async function markOrderPaid(db, orderId, version, updates) {
  const {
    paymentIntentId,
    checkoutSessionId,
    chargeId
  } = updates;
  await db.run(
    `UPDATE orders
     SET status = 'paid',
         payment_intent_id = COALESCE(payment_intent_id, ?),
         checkout_session_id = COALESCE(checkout_session_id, ?),
         charge_id = COALESCE(charge_id, ?),
         updated_at = ?
     WHERE id = ? AND version = ?`,
    [paymentIntentId || null, checkoutSessionId || null, chargeId || null, nowIso(), orderId, version]
  );
}

async function updateOrderCheckoutCreated(db, orderId, version, sessionId, paymentIntentId) {
  await db.run(
    `UPDATE orders
     SET status = CASE WHEN status = 'created' THEN 'checkout_created' ELSE status END,
         checkout_session_id = COALESCE(checkout_session_id, ?),
         payment_intent_id = COALESCE(payment_intent_id, ?),
         updated_at = ?
     WHERE id = ? AND version = ?`,
    [sessionId || null, paymentIntentId || null, nowIso(), orderId, version]
  );
}

async function updateOrderCharge(db, orderId, version, chargeId, paymentIntentId) {
  await db.run(
    `UPDATE orders
     SET charge_id = COALESCE(charge_id, ?),
         payment_intent_id = COALESCE(payment_intent_id, ?),
         updated_at = ?
     WHERE id = ? AND version = ?`,
    [chargeId || null, paymentIntentId || null, nowIso(), orderId, version]
  );
}

async function findOrderByPaymentIntent(db, paymentIntentId) {
  if (!paymentIntentId) return null;
  const rows = await db.all(
    `SELECT * FROM orders WHERE payment_intent_id = ? ORDER BY updated_at DESC LIMIT 1`,
    [paymentIntentId]
  );
  return rows[0] || null;
}

async function findOrderByCheckoutSession(db, sessionId) {
  if (!sessionId) return null;
  const rows = await db.all(
    `SELECT * FROM orders WHERE checkout_session_id = ? ORDER BY updated_at DESC LIMIT 1`,
    [sessionId]
  );
  return rows[0] || null;
}

async function findOrderByKey(db, orderId, version) {
  const rows = await db.all(`SELECT * FROM orders WHERE id = ? AND version = ?`, [orderId, version]);
  return rows[0] || null;
}

function logCommon(event) {
  console.log("stripe event", {
    id: event.id,
    type: event.type,
    created: event.created,
    object: event?.data?.object?.object || null
  });
}

async function handleCheckoutSessionCompleted(db, event) {
  const session = event.data.object;
  const payload = {
    session_id: session.id,
    mode: session.mode,
    customer: session.customer || null,
    subscription: session.subscription || null,
    payment_intent: session.payment_intent || null
  };
  const isSubscriptionPurchase = !!payload.subscription;
  console.log("checkout.session.completed", { ...payload, is_subscription_purchase: isSubscriptionPurchase });

  const key =
    parseOrderKeyFromMetadata(session.metadata) ||
    parseOrderKeyFromRef(session.client_reference_id);
  if (!key) {
    throw new Error("missing_order_key_in_session");
  }

  const order = await findOrderByKey(db, key.orderId, key.version);
  if (!order) {
    throw new Error("order_not_found");
  }

  // SoT check: if checkout_session_id exists and differs, mismatch.
  if (order.checkout_session_id && order.checkout_session_id !== session.id) {
    await markOrderMismatch(
      db,
      key.orderId,
      key.version,
      computeMismatchReason([{ field: "checkout_session_id", db: order.checkout_session_id, stripe: session.id }])
    );
    return;
  }

  await updateOrderCheckoutCreated(db, key.orderId, key.version, session.id, session.payment_intent || null);
}

async function handlePaymentIntentSucceeded(db, event) {
  const pi = event.data.object;
  const payload = {
    payment_intent_id: pi.id,
    amount: pi.amount,
    currency: pi.currency,
    customer: pi.customer || null
  };
  console.log("payment_intent.succeeded", payload);

  const key = parseOrderKeyFromMetadata(pi.metadata);
  let order = null;
  if (key) {
    order = await findOrderByKey(db, key.orderId, key.version);
  }
  if (!order) {
    order = await findOrderByPaymentIntent(db, pi.id);
  }
  if (!order) {
    throw new Error("order_not_found");
  }

  const mismatches = [];
  if (String(pi.currency || "").toLowerCase() !== "jpy") {
    mismatches.push({ field: "currency", db: "jpy", stripe: pi.currency });
  }
  if (Number(pi.amount) !== Number(order.total_amount_jpy)) {
    mismatches.push({ field: "amount", db: order.total_amount_jpy, stripe: pi.amount });
  }
  if (Number(pi.application_fee_amount || 0) !== Number(order.platform_fee_jpy)) {
    mismatches.push({ field: "application_fee_amount", db: order.platform_fee_jpy, stripe: pi.application_fee_amount || 0 });
  }
  const dest = pi.transfer_data?.destination || null;
  if (String(dest || "") !== String(order.destination_account_id || "")) {
    mismatches.push({ field: "transfer_data.destination", db: order.destination_account_id, stripe: dest });
  }

  if (mismatches.length) {
    await markOrderMismatch(db, order.id, Number(order.version), computeMismatchReason(mismatches));
    return;
  }

  await markOrderPaid(db, order.id, Number(order.version), {
    paymentIntentId: pi.id,
    checkoutSessionId: order.checkout_session_id || null,
    chargeId: order.charge_id || null
  });
}

async function handleChargeSucceeded(db, event) {
  const charge = event.data.object;
  const payload = {
    charge_id: charge.id,
    payment_intent: charge.payment_intent || null,
    receipt_email: charge.receipt_email || null,
    billing_details: charge.billing_details || null
  };
  console.log("charge.succeeded", payload);

  const piId = typeof charge.payment_intent === "string" ? charge.payment_intent : null;
  let order = null;
  if (piId) {
    order = await findOrderByPaymentIntent(db, piId);
  }
  if (!order) {
    // Fallback: if charge metadata has order key, use it.
    const key = parseOrderKeyFromMetadata(charge.metadata);
    if (key) order = await findOrderByKey(db, key.orderId, key.version);
  }
  if (!order) {
    throw new Error("order_not_found");
  }

  await updateOrderCharge(db, order.id, Number(order.version), charge.id, piId);
}

async function processStripeEvent(db, event) {
  logCommon(event);
  switch (event.type) {
    case "checkout.session.completed":
      await handleCheckoutSessionCompleted(db, event);
      return;
    case "payment_intent.succeeded":
      await handlePaymentIntentSucceeded(db, event);
      return;
    case "charge.succeeded":
      await handleChargeSucceeded(db, event);
      return;
    default:
      return;
  }
}

async function main() {
  const db = buildDb();
  console.log("stripe webhook worker starting", { mode: db.mode });

  // Poll loop
  // In production: run as a separate service/cron. This loop is intentionally simple and reliable.
  // Adjust interval/limit to match your webhook volume.
  const limit = Number(process.env.STRIPE_WEBHOOK_WORKER_BATCH || 25);
  const intervalMs = Number(process.env.STRIPE_WEBHOOK_WORKER_INTERVAL_MS || 1500);

  while (true) {
    const rows = await db.all(
      `SELECT event_id, payload_json
       FROM stripe_webhook_events
       WHERE status = 'pending'
       ORDER BY received_at ASC
       LIMIT ?`,
      [limit]
    );

    if (rows.length === 0) {
      await new Promise((r) => setTimeout(r, intervalMs));
      continue;
    }

    for (const row of rows) {
      const eventId = row.event_id;
      const claimed = await db.run(
        `UPDATE stripe_webhook_events
         SET status = 'processing',
             processing_started_at = ?
         WHERE event_id = ? AND status = 'pending'`,
        [nowIso(), eventId]
      );
      if (!claimed) continue;

      try {
        const event = JSON.parse(row.payload_json);
        await processStripeEvent(db, event);
        await db.run(
          `UPDATE stripe_webhook_events
           SET status = 'processed',
               processed_at = ?,
               processing_error = NULL
           WHERE event_id = ?`,
          [nowIso(), eventId]
        );
      } catch (err) {
        console.error("webhook event processing failed", { event_id: eventId, err });
        await db.run(
          `UPDATE stripe_webhook_events
           SET status = 'failed',
               processed_at = ?,
               processing_error = ?
           WHERE event_id = ?`,
          [nowIso(), String(err && err.message ? err.message : err), eventId]
        );
      }
    }
  }
}

main().catch((err) => {
  console.error("stripe webhook worker fatal", err);
  process.exit(1);
});

