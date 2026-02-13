const DEFAULT_AUTO_APPROVE_HOURS = 72;
const MIN_AUTO_APPROVE_HOURS = 24;
const MAX_AUTO_APPROVE_HOURS = 72;

export function getReviewPendingAutoApproveHours(): number {
  const raw = Number(process.env.REVIEW_PENDING_AUTO_APPROVE_HOURS ?? DEFAULT_AUTO_APPROVE_HOURS);
  if (!Number.isFinite(raw)) return DEFAULT_AUTO_APPROVE_HOURS;
  const rounded = Math.round(raw);
  if (rounded < MIN_AUTO_APPROVE_HOURS) return MIN_AUTO_APPROVE_HOURS;
  if (rounded > MAX_AUTO_APPROVE_HOURS) return MAX_AUTO_APPROVE_HOURS;
  return rounded;
}

export function computeReviewPendingDeadline(
  baseIso: string,
  hours = getReviewPendingAutoApproveHours()
): string {
  const baseMs = Date.parse(baseIso);
  const safeBaseMs = Number.isFinite(baseMs) ? baseMs : Date.now();
  return new Date(safeBaseMs + hours * 60 * 60 * 1000).toISOString();
}
