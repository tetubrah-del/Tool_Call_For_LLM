export type DisplayCurrency = "USD" | "JPY";
export type CurrencyCodeLower = "usd" | "jpy";

function usdToJpyRate() {
  const raw = Number(process.env.NEXT_PUBLIC_USD_TO_JPY_RATE || "150");
  if (!Number.isFinite(raw) || raw <= 0) return 150;
  return raw;
}

export function normalizeCurrencyCode(value: unknown): CurrencyCodeLower | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  if (v === "usd" || v === "jpy") return v;
  return null;
}

export function chooseDisplayCurrency(
  profileCountry: string | null | undefined,
  requestCountry: string | null | undefined
): DisplayCurrency {
  if ((profileCountry || "").toUpperCase() === "JP") return "JPY";
  if ((requestCountry || "").toUpperCase() === "JP") return "JPY";
  return "USD";
}

export function fromUsdForDisplay(amountUsd: number, currency: DisplayCurrency): number {
  const safe = Number(amountUsd || 0);
  if (!Number.isFinite(safe)) return 0;
  if (currency === "JPY") {
    return Math.round(safe * usdToJpyRate());
  }
  return Number(safe.toFixed(2));
}

export function formatUsdForDisplay(
  amountUsd: number,
  currency: DisplayCurrency,
  locale: string
): string {
  const value = fromUsdForDisplay(amountUsd, currency);
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "JPY" ? 0 : 2,
    minimumFractionDigits: currency === "JPY" ? 0 : 2
  }).format(value);
}

export function usdToMinor(amountUsd: number, currency: CurrencyCodeLower): number {
  const safe = Number(amountUsd || 0);
  if (!Number.isFinite(safe) || safe < 0) return 0;
  if (currency === "jpy") {
    return Math.round(safe * usdToJpyRate());
  }
  return Math.round(safe * 100);
}

export function minorToUsd(amountMinor: number, currency: CurrencyCodeLower): number {
  const safe = Number(amountMinor || 0);
  if (!Number.isFinite(safe) || safe < 0) return 0;
  if (currency === "jpy") {
    return Number((safe / usdToJpyRate()).toFixed(2));
  }
  return Number((safe / 100).toFixed(2));
}

export function minorToDisplayAmount(amountMinor: number, currency: CurrencyCodeLower): number {
  const safe = Number(amountMinor || 0);
  if (!Number.isFinite(safe) || safe < 0) return 0;
  if (currency === "jpy") return Math.round(safe);
  return Number((safe / 100).toFixed(2));
}
