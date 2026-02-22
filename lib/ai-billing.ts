import crypto from "crypto";
import type { DbClient } from "@/lib/db";
import type Stripe from "stripe";
import {
  getStripePreferred,
  isStripePermissionError,
  shouldPreferRestrictedKeyForServerOps
} from "@/lib/stripe";

type AiBillingRow = {
  id: string;
  name: string;
  paypal_email: string | null;
  status: string;
  deleted_at: string | null;
  stripe_customer_id: string | null;
  default_payment_method_id: string | null;
};

type OrderRow = {
  id: string;
  version: number;
  status: string;
  currency: "jpy" | "usd";
  total_amount_jpy: number;
  platform_fee_jpy: number;
  intl_surcharge_minor: number | null;
  destination_account_id: string;
  task_id: string | null;
  payment_intent_id: string | null;
};

type AuthorizationRow = {
  id: string;
  task_id: string;
  ai_account_id: string;
  order_id: string | null;
  order_version: number | null;
  payment_intent_id: string;
  amount_minor: number;
  currency: string;
  status: string;
  capture_before: string | null;
  authorized_at: string;
  captured_at: string | null;
  canceled_at: string | null;
  attempt_count: number;
  next_retry_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

type BillingErrorReason =
  | "ai_not_found"
  | "billing_not_ready"
  | "order_not_found"
  | "authorization_missing"
  | "authorization_expired"
  | "authorization_not_capturable"
  | "stripe_error"
  | "invalid_order_amount";

export type BillingResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: BillingErrorReason; message?: string | null };

function nowIso() {
  return new Date().toISOString();
}

function hoursFromNowIso(hours: number) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

function normalizeInt(value: unknown, fallback: number) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) return fallback;
  return n;
}

function captureRetryHours(attemptCount: number) {
  if (attemptCount <= 1) return 1;
  if (attemptCount === 2) return 24;
  return 72;
}

function maxCaptureRetries() {
  return Math.max(1, normalizeInt(process.env.PAYMENT_CAPTURE_MAX_RETRIES, 3));
}

function arrearsGraceHours() {
  return Math.max(1, normalizeInt(process.env.PAYMENT_ARREARS_GRACE_HOURS, 72));
}

async function getAiBillingRow(
  db: DbClient,
  aiAccountId: string
): Promise<AiBillingRow | null> {
  const row = await db
    .prepare(
      `SELECT id, name, paypal_email, status, deleted_at, stripe_customer_id, default_payment_method_id
       FROM ai_accounts
       WHERE id = ?`
    )
    .get<AiBillingRow>(aiAccountId);
  if (!row || row.deleted_at || row.status !== "active") return null;
  return row;
}

function toBillingError(reason: BillingErrorReason, message?: string | null): BillingResult<never> {
  return { ok: false, reason, message: message ?? null };
}

async function withStripe<T>(fn: (client: Stripe) => Promise<T>): Promise<T> {
  const preferRestricted = shouldPreferRestrictedKeyForServerOps();
  const { stripe, used, fallback } = getStripePreferred(preferRestricted);
  try {
    return await fn(stripe as Stripe);
  } catch (err: any) {
    if (used === "rk" && fallback && isStripePermissionError(err)) {
      return await fn(fallback as Stripe);
    }
    throw err;
  }
}

async function ensureStripeCustomer(
  db: DbClient,
  ai: AiBillingRow
): Promise<BillingResult<string>> {
  if (ai.stripe_customer_id && ai.stripe_customer_id.startsWith("cus_")) {
    return { ok: true, value: ai.stripe_customer_id };
  }
  try {
    const customer = await withStripe((client) =>
      client.customers.create({
        name: ai.name || undefined,
        email: ai.paypal_email || undefined,
        metadata: { ai_account_id: ai.id }
      })
    );
    await db
      .prepare(
        `UPDATE ai_accounts
         SET stripe_customer_id = ?
         WHERE id = ?`
      )
      .run(customer.id, ai.id);
    return { ok: true, value: customer.id };
  } catch (err: any) {
    return toBillingError("stripe_error", err?.message || "stripe_customer_create_failed");
  }
}

function readCaptureBeforeIso(pi: Stripe.PaymentIntent): string | null {
  const latestCharge = pi.latest_charge;
  if (!latestCharge || typeof latestCharge === "string") return null;
  const captureBefore = (latestCharge as Stripe.Charge).payment_method_details?.card?.capture_before;
  if (!captureBefore || !Number.isFinite(Number(captureBefore))) return null;
  return new Date(Number(captureBefore) * 1000).toISOString();
}

async function upsertAuthorizationRow(
  db: DbClient,
  params: {
    taskId: string;
    aiAccountId: string;
    orderId: string | null;
    orderVersion: number | null;
    paymentIntentId: string;
    amountMinor: number;
    currency: string;
    status: string;
    captureBefore: string | null;
    attemptCount: number;
    nextRetryAt: string | null;
    lastError: string | null;
  }
) {
  const now = nowIso();
  const existing = await db
    .prepare(`SELECT id FROM payment_authorizations WHERE payment_intent_id = ?`)
    .get<{ id: string }>(params.paymentIntentId);
  if (existing?.id) {
    await db
      .prepare(
        `UPDATE payment_authorizations
         SET status = ?,
             capture_before = ?,
             attempt_count = ?,
             next_retry_at = ?,
             last_error = ?,
             updated_at = ?
         WHERE id = ?`
      )
      .run(
        params.status,
        params.captureBefore,
        params.attemptCount,
        params.nextRetryAt,
        params.lastError,
        now,
        existing.id
      );
    return existing.id;
  }

  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO payment_authorizations (
        id, task_id, ai_account_id, order_id, order_version, payment_intent_id,
        amount_minor, currency, status, capture_before, authorized_at, captured_at,
        canceled_at, attempt_count, next_retry_at, last_error, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      params.taskId,
      params.aiAccountId,
      params.orderId,
      params.orderVersion,
      params.paymentIntentId,
      params.amountMinor,
      params.currency,
      params.status,
      params.captureBefore,
      now,
      params.attemptCount,
      params.nextRetryAt,
      params.lastError,
      now,
      now
    );
  return id;
}

async function markTaskPaymentFailed(
  db: DbClient,
  taskId: string,
  reason: string
) {
  await db
    .prepare(
      `UPDATE tasks
       SET paid_status = CASE WHEN COALESCE(paid_status, 'pending') = 'paid' THEN paid_status ELSE 'failed' END,
           payment_error_message = ?
       WHERE id = ? AND deleted_at IS NULL`
    )
    .run(reason, taskId);
}

export async function createPaymentArrear(
  db: DbClient,
  params: {
    aiAccountId: string;
    taskId: string;
    authorizationId: string | null;
    currency: string;
    amountMinor: number;
    reason: string;
  }
) {
  const existing = await db
    .prepare(
      `SELECT id
       FROM payment_arrears
       WHERE ai_account_id = ?
         AND task_id = ?
         AND status IN ('open', 'collecting')
       ORDER BY created_at DESC
       LIMIT 1`
    )
    .get<{ id: string }>(params.aiAccountId, params.taskId);
  if (existing?.id) return existing.id;

  const now = nowIso();
  const dueAt = hoursFromNowIso(arrearsGraceHours());
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO payment_arrears (
        id, ai_account_id, task_id, payment_authorization_id, currency, amount_minor,
        reason, status, due_at, last_attempt_at, settled_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, NULL, NULL, ?, ?)`
    )
    .run(
      id,
      params.aiAccountId,
      params.taskId,
      params.authorizationId,
      params.currency,
      params.amountMinor,
      params.reason,
      dueAt,
      now,
      now
    );
  return id;
}

export async function createSetupIntentForAi(
  db: DbClient,
  aiAccountId: string
): Promise<
  BillingResult<{ setup_intent_id: string; client_secret: string; stripe_customer_id: string }>
> {
  const ai = await getAiBillingRow(db, aiAccountId);
  if (!ai) return toBillingError("ai_not_found");
  const ensured = await ensureStripeCustomer(db, ai);
  if (ensured.ok === false) return toBillingError(ensured.reason, ensured.message);

  try {
    const setupIntent = await withStripe((client) =>
      client.setupIntents.create({
        customer: ensured.value,
        usage: "off_session",
        automatic_payment_methods: { enabled: true },
        metadata: { ai_account_id: aiAccountId }
      })
    );
    if (!setupIntent.client_secret) {
      return toBillingError("stripe_error", "setup_intent_missing_client_secret");
    }
    return {
      ok: true,
      value: {
        setup_intent_id: setupIntent.id,
        client_secret: setupIntent.client_secret,
        stripe_customer_id: ensured.value
      }
    };
  } catch (err: any) {
    return toBillingError("stripe_error", err?.message || "setup_intent_create_failed");
  }
}

export async function setDefaultPaymentMethodForAi(
  db: DbClient,
  aiAccountId: string,
  paymentMethodId: string
): Promise<BillingResult<{ stripe_customer_id: string; default_payment_method_id: string }>> {
  const ai = await getAiBillingRow(db, aiAccountId);
  if (!ai) return toBillingError("ai_not_found");
  if (!paymentMethodId || !paymentMethodId.startsWith("pm_")) {
    return toBillingError("billing_not_ready", "invalid_payment_method_id");
  }
  const ensured = await ensureStripeCustomer(db, ai);
  if (ensured.ok === false) return toBillingError(ensured.reason, ensured.message);

  try {
    await withStripe(async (client) => {
      try {
        await client.paymentMethods.attach(paymentMethodId, { customer: ensured.value });
      } catch (err: any) {
        const message = String(err?.message || "");
        // Already attached to this customer is safe and can be treated as success.
        if (!message.includes("already attached")) throw err;
      }
      await client.customers.update(ensured.value, {
        invoice_settings: { default_payment_method: paymentMethodId }
      });
    });
  } catch (err: any) {
    return toBillingError("stripe_error", err?.message || "set_default_payment_method_failed");
  }

  const now = nowIso();
  await db
    .prepare(
      `UPDATE ai_accounts
       SET stripe_customer_id = ?,
           default_payment_method_id = ?,
           billing_consent_at = COALESCE(billing_consent_at, ?)
       WHERE id = ?`
    )
    .run(ensured.value, paymentMethodId, now, aiAccountId);

  return {
    ok: true,
    value: { stripe_customer_id: ensured.value, default_payment_method_id: paymentMethodId }
  };
}

export async function authorizeOrderPayment(
  db: DbClient,
  params: {
    aiAccountId: string;
    orderId: string;
    orderVersion: number;
  }
): Promise<
  BillingResult<{
    payment_intent_id: string;
    authorization_id: string;
    status: string;
    capture_before: string | null;
  }>
> {
  const ai = await getAiBillingRow(db, params.aiAccountId);
  if (!ai) return toBillingError("ai_not_found");
  if (!ai.default_payment_method_id) {
    return toBillingError("billing_not_ready", "default_payment_method_missing");
  }
  const ensured = await ensureStripeCustomer(db, ai);
  if (ensured.ok === false) return toBillingError(ensured.reason, ensured.message);

  const order = await db
    .prepare(
      `SELECT id, version, status, currency, total_amount_jpy, platform_fee_jpy, intl_surcharge_minor,
              destination_account_id, task_id, payment_intent_id
       FROM orders
       WHERE id = ? AND version = ?`
    )
    .get<OrderRow>(params.orderId, params.orderVersion);
  if (!order) return toBillingError("order_not_found");

  const existing = await db
    .prepare(
      `SELECT *
       FROM payment_authorizations
       WHERE order_id = ? AND order_version = ?
       ORDER BY created_at DESC
       LIMIT 1`
    )
    .get<AuthorizationRow>(params.orderId, params.orderVersion);
  if (existing?.id && ["authorized", "capture_pending", "captured"].includes(existing.status)) {
    return {
      ok: true,
      value: {
        payment_intent_id: existing.payment_intent_id,
        authorization_id: existing.id,
        status: existing.status,
        capture_before: existing.capture_before
      }
    };
  }

  const amountMinor = Number(order.total_amount_jpy);
  const platformFeeMinor = Number(order.platform_fee_jpy);
  const surchargeMinor = Number(order.intl_surcharge_minor || 0);
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
    return toBillingError("invalid_order_amount", "invalid_total_amount");
  }
  const applicationFeeMinor = platformFeeMinor + surchargeMinor;

  let paymentIntent: Stripe.PaymentIntent;
  try {
    paymentIntent = await withStripe((client) =>
      client.paymentIntents.create({
        amount: amountMinor,
        currency: order.currency,
        customer: ensured.value,
        payment_method: ai.default_payment_method_id || undefined,
        confirm: true,
        off_session: true,
        capture_method: "manual",
        metadata: {
          ai_account_id: params.aiAccountId,
          task_id: String(order.task_id || ""),
          order_id: params.orderId,
          version: String(params.orderVersion)
        },
        application_fee_amount: applicationFeeMinor,
        transfer_data: { destination: String(order.destination_account_id || "") },
        expand: ["latest_charge"]
      })
    );
  } catch (err: any) {
    return toBillingError("stripe_error", err?.message || "payment_intent_authorization_failed");
  }

  if (paymentIntent.status !== "requires_capture" && paymentIntent.status !== "succeeded") {
    return toBillingError("authorization_not_capturable", paymentIntent.status);
  }

  const captureBefore = readCaptureBeforeIso(paymentIntent);
  const now = nowIso();
  const status = paymentIntent.status === "succeeded" ? "captured" : "authorized";
  const authorizationId = await upsertAuthorizationRow(db, {
    taskId: String(order.task_id || ""),
    aiAccountId: params.aiAccountId,
    orderId: params.orderId,
    orderVersion: params.orderVersion,
    paymentIntentId: paymentIntent.id,
    amountMinor,
    currency: order.currency,
    status,
    captureBefore,
    attemptCount: 0,
    nextRetryAt: null,
    lastError: null
  });

  await db
    .prepare(
      `UPDATE orders
       SET payment_intent_id = COALESCE(payment_intent_id, ?),
           updated_at = ?
       WHERE id = ? AND version = ?`
    )
    .run(paymentIntent.id, now, params.orderId, params.orderVersion);

  return {
    ok: true,
    value: {
      payment_intent_id: paymentIntent.id,
      authorization_id: authorizationId,
      status,
      capture_before: captureBefore
    }
  };
}

export async function captureOrderAuthorization(
  db: DbClient,
  params: {
    aiAccountId: string;
    orderId: string;
    orderVersion: number;
  }
): Promise<
  BillingResult<{
    payment_intent_id: string;
    authorization_id: string;
    status: string;
    capture_before: string | null;
    already_captured: boolean;
  }>
> {
  const authRow = await db
    .prepare(
      `SELECT *
       FROM payment_authorizations
       WHERE order_id = ? AND order_version = ?
       ORDER BY created_at DESC
       LIMIT 1`
    )
    .get<AuthorizationRow>(params.orderId, params.orderVersion);
  if (!authRow?.id) return toBillingError("authorization_missing");

  const order = await db
    .prepare(
      `SELECT id, version, status, currency, total_amount_jpy, task_id
       FROM orders
       WHERE id = ? AND version = ?`
    )
    .get<OrderRow>(params.orderId, params.orderVersion);
  if (!order) return toBillingError("order_not_found");

  const captureBeforeMs = authRow.capture_before ? Date.parse(authRow.capture_before) : NaN;
  if (Number.isFinite(captureBeforeMs) && captureBeforeMs <= Date.now()) {
    await db
      .prepare(
        `UPDATE payment_authorizations
         SET status = 'expired',
             updated_at = ?,
             last_error = 'authorization_expired'
         WHERE id = ?`
      )
      .run(nowIso(), authRow.id);
    if (order.task_id) {
      await markTaskPaymentFailed(db, String(order.task_id), "authorization_expired");
      await createPaymentArrear(db, {
        aiAccountId: authRow.ai_account_id,
        taskId: String(order.task_id),
        authorizationId: authRow.id,
        currency: authRow.currency,
        amountMinor: authRow.amount_minor,
        reason: "authorization_expired"
      });
    }
    return toBillingError("authorization_expired", "authorization_expired");
  }

  if (authRow.status === "captured") {
    return {
      ok: true,
      value: {
        payment_intent_id: authRow.payment_intent_id,
        authorization_id: authRow.id,
        status: authRow.status,
        capture_before: authRow.capture_before,
        already_captured: true
      }
    };
  }
  if (!["authorized", "capture_pending", "capture_failed"].includes(authRow.status)) {
    return toBillingError("authorization_not_capturable", authRow.status);
  }

  const attemptCount = Number(authRow.attempt_count || 0) + 1;
  await db
    .prepare(
      `UPDATE payment_authorizations
       SET status = 'capture_pending',
           attempt_count = ?,
           updated_at = ?
       WHERE id = ?`
    )
    .run(attemptCount, nowIso(), authRow.id);

  try {
    const idempotencyKey = `capture:${params.orderId}:v${params.orderVersion}:attempt:${attemptCount}`;
    const paymentIntent = await withStripe((client) =>
      client.paymentIntents.capture(authRow.payment_intent_id, {}, { idempotencyKey })
    );
    await db
      .prepare(
        `UPDATE payment_authorizations
         SET status = 'captured',
             captured_at = ?,
             next_retry_at = NULL,
             last_error = NULL,
             updated_at = ?
         WHERE id = ?`
      )
      .run(nowIso(), nowIso(), authRow.id);
    await db
      .prepare(
        `UPDATE orders
         SET status = CASE WHEN status IN ('created', 'checkout_created') THEN 'paid' ELSE status END,
             provider_error = NULL,
             updated_at = ?
         WHERE id = ? AND version = ?`
      )
      .run(nowIso(), params.orderId, params.orderVersion);
    return {
      ok: true,
      value: {
        payment_intent_id: paymentIntent.id,
        authorization_id: authRow.id,
        status: "captured",
        capture_before: authRow.capture_before,
        already_captured: false
      }
    };
  } catch (err: any) {
    const message = String(err?.message || "capture_failed");
    const retryHours = captureRetryHours(attemptCount);
    const nextRetryAt = hoursFromNowIso(retryHours);
    const maxRetries = maxCaptureRetries();
    await db
      .prepare(
        `UPDATE payment_authorizations
         SET status = 'capture_failed',
             next_retry_at = ?,
             last_error = ?,
             updated_at = ?
         WHERE id = ?`
      )
      .run(nextRetryAt, message, nowIso(), authRow.id);

    if (order.task_id) {
      await markTaskPaymentFailed(db, String(order.task_id), message);
    }
    if (attemptCount >= maxRetries && order.task_id) {
      await createPaymentArrear(db, {
        aiAccountId: authRow.ai_account_id,
        taskId: String(order.task_id),
        authorizationId: authRow.id,
        currency: authRow.currency,
        amountMinor: authRow.amount_minor,
        reason: message
      });
    }
    return toBillingError("stripe_error", message);
  }
}
