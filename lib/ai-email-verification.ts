import crypto from "crypto";
import type { DbClient } from "@/lib/db";

type TokenRow = {
  id: string;
  ai_account_id: string;
  email: string;
  token_hash: string;
  created_at: string;
  expires_at: string;
  used_at: string | null;
};

function nowIso() {
  return new Date().toISOString();
}

function getBaseUrl(request: Request): string {
  const configured = (process.env.APP_BASE_URL || process.env.NEXTAUTH_URL || "")
    .trim()
    .replace(/\/+$/, "");
  if (configured) return configured;
  return new URL(request.url).origin;
}

function verificationTtlMinutes() {
  const raw = Number(process.env.AI_EMAIL_VERIFICATION_TTL_MINUTES || 60);
  if (!Number.isFinite(raw) || raw <= 0) return 60;
  return Math.min(Math.floor(raw), 24 * 60);
}

function hashToken(token: string): string {
  const pepper = process.env.AI_EMAIL_VERIFICATION_PEPPER || "";
  return crypto
    .createHash("sha256")
    .update(`${pepper}:${token}`)
    .digest("hex");
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return email;
  if (local.length <= 2) return `**@${domain}`;
  return `${local.slice(0, 2)}***@${domain}`;
}

export function buildVerificationUrl(request: Request, aiAccountId: string, token: string): string {
  const base = getBaseUrl(request);
  const url = new URL("/api/ai/accounts/verification/confirm", base);
  url.searchParams.set("ai_account_id", aiAccountId);
  url.searchParams.set("token", token);
  return url.toString();
}

export async function enqueueAiVerificationEmail(
  db: DbClient,
  params: {
    aiAccountId: string;
    toEmail: string;
    verifyUrl: string;
  }
) {
  const createdAt = nowIso();
  const ttlMinutes = verificationTtlMinutes();
  const subject = "[Sinkai] Verify your AI account email";
  const bodyText = [
    "Please verify your AI account email to enable task execution.",
    "",
    `Account ID: ${params.aiAccountId}`,
    `Verification link: ${params.verifyUrl}`,
    "",
    `This link expires in ${ttlMinutes} minutes.`
  ].join("\n");
  await db
    .prepare(
      `INSERT INTO email_deliveries
       (id, event_id, to_email, template_key, subject, body_text, status, attempt_count, next_attempt_at, provider_message_id, last_error, created_at, updated_at, sent_at)
       VALUES (?, ?, ?, ?, ?, ?, 'queued', 0, ?, NULL, NULL, ?, ?, NULL)`
    )
    .run(
      crypto.randomUUID(),
      crypto.randomUUID(),
      params.toEmail,
      "ai_email_verification",
      subject,
      bodyText,
      createdAt,
      createdAt,
      createdAt
    );
}

export async function issueAiEmailVerificationToken(
  db: DbClient,
  params: {
    aiAccountId: string;
    email: string;
  }
) {
  const token = crypto.randomBytes(24).toString("hex");
  const tokenHash = hashToken(token);
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + verificationTtlMinutes() * 60 * 1000).toISOString();

  await db
    .prepare(
      `UPDATE ai_email_verification_tokens
       SET used_at = COALESCE(used_at, ?)
       WHERE ai_account_id = ? AND used_at IS NULL`
    )
    .run(createdAt, params.aiAccountId);

  await db
    .prepare(
      `INSERT INTO ai_email_verification_tokens
       (id, ai_account_id, email, token_hash, created_at, expires_at, used_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL)`
    )
    .run(
      crypto.randomUUID(),
      params.aiAccountId,
      params.email,
      tokenHash,
      createdAt,
      expiresAt
    );

  return { token, expiresAt };
}

export async function verifyAiEmailToken(
  db: DbClient,
  params: {
    aiAccountId: string;
    token: string;
  }
):
  Promise<
    | { ok: true; verifiedAt: string }
    | { ok: false; reason: "invalid_token" | "expired_token" | "token_already_used" | "account_not_found" }
  > {
  const tokenHash = hashToken(params.token);
  const row = await db
    .prepare(
      `SELECT id, ai_account_id, email, token_hash, created_at, expires_at, used_at
       FROM ai_email_verification_tokens
       WHERE ai_account_id = ? AND token_hash = ?
       ORDER BY created_at DESC
       LIMIT 1`
    )
    .get<TokenRow>(params.aiAccountId, tokenHash);
  if (!row?.id) return { ok: false, reason: "invalid_token" };
  if (row.used_at) return { ok: false, reason: "token_already_used" };
  if (!Number.isFinite(Date.parse(row.expires_at)) || Date.parse(row.expires_at) < Date.now()) {
    return { ok: false, reason: "expired_token" };
  }

  const verifiedAt = nowIso();
  const updated = await db
    .prepare(
      `UPDATE ai_accounts
       SET email_verified_at = COALESCE(email_verified_at, ?)
       WHERE id = ? AND deleted_at IS NULL`
    )
    .run(verifiedAt, params.aiAccountId);
  if (updated < 1) return { ok: false, reason: "account_not_found" };

  await db
    .prepare(
      `UPDATE ai_email_verification_tokens
       SET used_at = ?
       WHERE id = ?`
    )
    .run(verifiedAt, row.id);

  return { ok: true, verifiedAt };
}
