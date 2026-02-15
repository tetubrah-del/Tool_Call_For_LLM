export type DisplayCurrency = "USD" | "JPY";

function usdToJpyRate() {
  const raw = Number(process.env.NEXT_PUBLIC_USD_TO_JPY_RATE || "150");
  if (!Number.isFinite(raw) || raw <= 0) return 150;
  return raw;
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

