import { normalizeCountry } from "@/lib/country";

const COUNTRY_HEADER_CANDIDATES = [
  "x-vercel-ip-country",
  "cf-ipcountry",
  "cloudfront-viewer-country",
  "x-country-code",
  "x-geo-country"
];

export function getRequestCountry(request: Request): string | null {
  for (const header of COUNTRY_HEADER_CANDIDATES) {
    const value = request.headers.get(header);
    const normalized = normalizeCountry(value);
    if (normalized) return normalized;
  }
  return null;
}

