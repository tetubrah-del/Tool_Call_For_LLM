import crypto from "crypto";

const DEFAULT_TIKTOK_AUTH_BASE_URL = "https://www.tiktok.com";
const DEFAULT_TIKTOK_API_BASE_URL = "https://open.tiktokapis.com";
const DEFAULT_TIKTOK_SCOPES = "user.info.basic,video.upload";
const STATE_TTL_MS = 10 * 60 * 1000;

export function isTikTokMarketingEnabled() {
  const value = (process.env.MARKETING_TIKTOK_ENABLED || "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

export type TikTokAuthConfig = {
  clientKey: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string;
  authBaseUrl: string;
  apiBaseUrl: string;
  stateSecret: string;
};

export function readTikTokAuthConfig(): TikTokAuthConfig | null {
  const clientKey = (process.env.MARKETING_TIKTOK_CLIENT_KEY || "").trim();
  const clientSecret = (process.env.MARKETING_TIKTOK_CLIENT_SECRET || "").trim();
  const redirectUri = (process.env.MARKETING_TIKTOK_REDIRECT_URI || "").trim();
  const scopes = (process.env.MARKETING_TIKTOK_SCOPES || DEFAULT_TIKTOK_SCOPES).trim();
  const authBaseUrl = (
    process.env.MARKETING_TIKTOK_AUTH_BASE_URL || DEFAULT_TIKTOK_AUTH_BASE_URL
  ).trim();
  const apiBaseUrl = (
    process.env.MARKETING_TIKTOK_API_BASE_URL || DEFAULT_TIKTOK_API_BASE_URL
  ).trim();
  const stateSecret = (
    process.env.MARKETING_TIKTOK_STATE_SECRET || process.env.NEXTAUTH_SECRET || ""
  ).trim();
  if (!clientKey || !clientSecret || !redirectUri || !stateSecret) {
    return null;
  }
  return { clientKey, clientSecret, redirectUri, scopes, authBaseUrl, apiBaseUrl, stateSecret };
}

function signStatePayload(payload: string, secret: string) {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

export function createOAuthState(secret: string, nowMs = Date.now()) {
  const nonce = crypto.randomBytes(12).toString("hex");
  const issuedAt = String(nowMs);
  const payload = `${issuedAt}.${nonce}`;
  const signature = signStatePayload(payload, secret);
  return Buffer.from(`${payload}.${signature}`, "utf8").toString("base64url");
}

export function verifyOAuthState(value: string, secret: string, nowMs = Date.now()) {
  if (!value) return false;
  let decoded = "";
  try {
    decoded = Buffer.from(value, "base64url").toString("utf8");
  } catch {
    return false;
  }
  const parts = decoded.split(".");
  if (parts.length !== 3) return false;
  const issuedAt = Number(parts[0]);
  const nonce = parts[1];
  const signature = parts[2];
  if (!Number.isFinite(issuedAt) || !nonce || !signature) return false;
  if (Math.abs(nowMs - issuedAt) > STATE_TTL_MS) return false;
  const payload = `${issuedAt}.${nonce}`;
  const expected = signStatePayload(payload, secret);
  const actualBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);
  if (actualBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(actualBuf, expectedBuf);
}

export function buildAuthorizeUrl(config: TikTokAuthConfig) {
  const state = createOAuthState(config.stateSecret);
  const url = new URL("/v2/auth/authorize/", config.authBaseUrl);
  url.searchParams.set("client_key", config.clientKey);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", config.scopes);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("state", state);
  return { url: url.toString(), state };
}

export type TikTokTokenResponse = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_expires_in?: number;
  open_id?: string;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
  [key: string]: unknown;
};

export async function exchangeCodeForToken(config: TikTokAuthConfig, code: string) {
  const tokenUrl = new URL("/v2/oauth/token/", config.apiBaseUrl).toString();
  const body = new URLSearchParams();
  body.set("client_key", config.clientKey);
  body.set("client_secret", config.clientSecret);
  body.set("code", code);
  body.set("grant_type", "authorization_code");
  body.set("redirect_uri", config.redirectUri);

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    cache: "no-store"
  });

  const payload: TikTokTokenResponse = await response.json().catch(() => ({}));
  if (!response.ok || payload.error) {
    const message =
      (typeof payload.error_description === "string" && payload.error_description) ||
      (typeof payload.error === "string" && payload.error) ||
      `token_exchange_failed_${response.status}`;
    throw new Error(message);
  }
  return payload;
}
