export type AiEmailBlockReason = "reserved_domain" | "disposable_domain";

const RESERVED_EXACT_DOMAINS = new Set([
  "example.com",
  "example.org",
  "example.net"
]);

const RESERVED_SUFFIXES = [".example", ".invalid", ".localhost", ".test"];

const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com",
  "guerrillamail.com",
  "yopmail.com",
  "10minutemail.com",
  "temp-mail.org",
  "tempmail.plus",
  "sharklasers.com",
  "dispostable.com",
  "throwawaymail.com"
]);

function parseAllowedDomains(raw: string | undefined): Set<string> {
  return new Set(
    String(raw || "")
      .split(",")
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean)
  );
}

export function getEmailDomain(email: string): string {
  const idx = email.lastIndexOf("@");
  if (idx <= 0 || idx >= email.length - 1) return "";
  return email.slice(idx + 1).trim().toLowerCase();
}

function isReservedDomain(domain: string): boolean {
  if (!domain) return true;
  if (RESERVED_EXACT_DOMAINS.has(domain)) return true;
  return RESERVED_SUFFIXES.some((suffix) => domain.endsWith(suffix));
}

function isDisposableDomain(domain: string): boolean {
  if (!domain) return false;
  if (DISPOSABLE_DOMAINS.has(domain)) return true;
  return Array.from(DISPOSABLE_DOMAINS).some((d) => domain.endsWith(`.${d}`));
}

export function validateAiOperatorEmailDomain(email: string):
  | { ok: true; domain: string }
  | { ok: false; domain: string; reason: AiEmailBlockReason } {
  const domain = getEmailDomain(email);
  const allowed = parseAllowedDomains(process.env.ALLOW_TEST_EMAIL_DOMAINS);
  if (allowed.has(domain)) {
    return { ok: true, domain };
  }
  if (isReservedDomain(domain)) {
    return { ok: false, domain, reason: "reserved_domain" };
  }
  if (isDisposableDomain(domain)) {
    return { ok: false, domain, reason: "disposable_domain" };
  }
  return { ok: true, domain };
}

