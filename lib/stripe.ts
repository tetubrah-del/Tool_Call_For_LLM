import Stripe from "stripe";

type StripeClients = {
  sk: Stripe;
  rk: Stripe | null;
};

function getEnv(name: string) {
  return (process.env[name] || "").trim();
}

function requireEnv(name: string) {
  const v = getEnv(name);
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

function isSk(key: string) {
  return key.startsWith("sk_live_") || key.startsWith("sk_test_");
}

function isRk(key: string) {
  return key.startsWith("rk_live_") || key.startsWith("rk_test_");
}

export function getStripeClients(): StripeClients {
  const sk = requireEnv("STRIPE_SECRET_KEY");
  if (!isSk(sk)) {
    throw new Error(
      "STRIPE_SECRET_KEY must be a full secret key (sk_live_...) per ops policy."
    );
  }
  const rk = getEnv("STRIPE_RESTRICTED_KEY");
  if (rk && !isRk(rk)) {
    throw new Error("STRIPE_RESTRICTED_KEY must be a restricted key (rk_live_...)");
  }

  const skClient = new Stripe(sk);
  const rkClient = rk ? new Stripe(rk) : null;
  return { sk: skClient, rk: rkClient };
}

export function getStripePreferred(preferRestricted: boolean) {
  const { sk, rk } = getStripeClients();
  if (preferRestricted && rk) return { stripe: rk, used: "rk" as const, fallback: sk };
  return { stripe: sk, used: "sk" as const, fallback: null };
}

export function shouldPreferRestrictedKeyForServerOps() {
  // Default: use sk_ (explicitly required).
  // Set STRIPE_PREFER_RESTRICTED_KEY=1 to attempt rk_ first; if it fails with permission errors, fall back to sk_.
  return getEnv("STRIPE_PREFER_RESTRICTED_KEY") === "1";
}

export type Country2 = "JP" | "US";

export function normalizeCountry2(value: unknown): Country2 | null {
  const v = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (v === "JP" || v === "US") return v;
  return null;
}

export function assertNonNegativeInt(value: unknown, field: string) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) {
    const err = new Error(`${field} must be a non-negative integer`);
    (err as any).statusCode = 400;
    throw err;
  }
  return n;
}

export type Currency = "jpy" | "usd";

export function currencyFromCountry2(country: Country2): Currency {
  // MVP scope: JP/US only.
  return country === "JP" ? "jpy" : "usd";
}

export function computePlatformFeeMinorFloor(totalAmountMinor: number) {
  // floor(total * 20 / 100) in integer math (minor units)
  if (!Number.isInteger(totalAmountMinor) || totalAmountMinor < 0) {
    const err = new Error("total_amount_minor must be a non-negative integer");
    (err as any).statusCode = 400;
    throw err;
  }
  return Math.floor((totalAmountMinor * 20) / 100);
}

// Back-compat helper: legacy name used throughout the codebase.
export function computePlatformFeeJpyFloor(totalAmountJpy: number) {
  return computePlatformFeeMinorFloor(totalAmountJpy);
}

function getEnvInt(name: string, fallback: number) {
  const raw = getEnv(name);
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isInteger(n) ? n : fallback;
}

export function computeIntlSurchargeMinor(
  subtotalMinor: number,
  currency: Currency,
  isInternational: boolean
) {
  if (!isInternational) return 0;
  if (!Number.isInteger(subtotalMinor) || subtotalMinor < 0) {
    const err = new Error("subtotal_minor must be a non-negative integer");
    (err as any).statusCode = 400;
    throw err;
  }

  // Defaults: conservative buffer for cross-border + risk. Override via env.
  // - INTL_SURCHARGE_BPS: surcharge in basis points applied to subtotal.
  // - INTL_SURCHARGE_MIN_JPY: minimum surcharge when currency=jpy (minor unit = yen).
  // - INTL_SURCHARGE_MIN_USD_CENTS: minimum surcharge when currency=usd (minor unit = cents).
  const bps = getEnvInt("INTL_SURCHARGE_BPS", 300); // 3.00%
  const min =
    currency === "jpy"
      ? getEnvInt("INTL_SURCHARGE_MIN_JPY", 100)
      : getEnvInt("INTL_SURCHARGE_MIN_USD_CENTS", 100);

  const pct = Math.floor((subtotalMinor * bps) / 10000);
  return Math.max(pct, min);
}

export function computeIsInternational(payer: Country2, payee: Country2) {
  return payer !== payee ? 1 : 0;
}

export function buildIdempotencyKey(action: string, orderId: string, version: number) {
  const a = String(action || "").trim();
  const id = String(orderId || "").trim();
  const v = Number(version);
  if (!a || !id || !Number.isInteger(v) || v <= 0) {
    const err = new Error("invalid idempotency key inputs");
    (err as any).statusCode = 400;
    throw err;
  }
  return `${a}:${id}:v${v}`;
}

export function isStripePermissionError(err: any) {
  const code = err?.code;
  const type = err?.type;
  // Stripe commonly uses "StripePermissionError" / "permission_denied" depending on SDK.
  return type === "StripePermissionError" || code === "permission_denied";
}

export async function retrieveConnectedAccountOrThrow(
  stripe: Stripe,
  accountId: string
): Promise<Stripe.Account> {
  if (!accountId.startsWith("acct_")) {
    const err = new Error("destination_account_id must be acct_...");
    (err as any).statusCode = 400;
    throw err;
  }
  return stripe.accounts.retrieve(accountId);
}

export function ensureDestinationChargePreconditions(
  account: Stripe.Account,
  expectedCountry: Country2
) {
  // Express account: must be in allowed countries and generally capable of receiving transfers.
  const country = (account.country || "").toUpperCase();
  if (country !== expectedCountry) {
    const err = new Error("connected account country mismatch");
    (err as any).statusCode = 409;
    throw err;
  }
  // For destination charges, the connected account must be able to receive transfers.
  // capabilities may be missing depending on permissions; handle conservatively.
  const transfers = (account.capabilities as any)?.transfers;
  if (transfers && transfers !== "active") {
    const err = new Error("connected account transfers capability not active");
    (err as any).statusCode = 409;
    throw err;
  }
  return true;
}
