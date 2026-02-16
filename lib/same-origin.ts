function tryOrigin(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function normalizeProto(value: string | null): "http" | "https" {
  const raw = (value || "").split(",")[0].trim().toLowerCase();
  return raw === "http" ? "http" : "https";
}

function normalizeHost(value: string | null): string | null {
  const raw = (value || "").split(",")[0].trim().toLowerCase();
  return raw || null;
}

function buildForwardedOrigin(request: Request): string | null {
  const proto = normalizeProto(
    request.headers.get("x-forwarded-proto") ||
      request.headers.get("x-forwarded-protocol")
  );
  const host =
    normalizeHost(request.headers.get("x-forwarded-host")) ||
    normalizeHost(request.headers.get("host"));
  if (!host) return null;
  return `${proto}://${host}`;
}

export function isSameOriginRequest(request: Request): boolean {
  const browserOrigin =
    tryOrigin(request.headers.get("origin")) ||
    tryOrigin(request.headers.get("referer"));
  if (!browserOrigin) return false;

  const candidates = new Set<string>();
  const reqOrigin = tryOrigin(request.url);
  if (reqOrigin) candidates.add(reqOrigin);
  const fwdOrigin = buildForwardedOrigin(request);
  if (fwdOrigin) candidates.add(fwdOrigin);

  for (const c of candidates) {
    if (browserOrigin === c) return true;
  }
  return false;
}
