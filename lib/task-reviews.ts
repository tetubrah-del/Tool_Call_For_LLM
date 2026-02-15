const DEFAULT_REVIEW_DEADLINE_DAYS = 7;
const MIN_REVIEW_DEADLINE_DAYS = 1;
const MAX_REVIEW_DEADLINE_DAYS = 30;

export function getReviewDeadlineDays(): number {
  const raw = Number(process.env.REVIEW_DEADLINE_DAYS ?? DEFAULT_REVIEW_DEADLINE_DAYS);
  if (!Number.isFinite(raw)) return DEFAULT_REVIEW_DEADLINE_DAYS;
  const rounded = Math.round(raw);
  if (rounded < MIN_REVIEW_DEADLINE_DAYS) return MIN_REVIEW_DEADLINE_DAYS;
  if (rounded > MAX_REVIEW_DEADLINE_DAYS) return MAX_REVIEW_DEADLINE_DAYS;
  return rounded;
}

export function computeReviewDeadlineAt(
  baseIso: string,
  days = getReviewDeadlineDays()
): string {
  const baseMs = Date.parse(baseIso);
  const safeBaseMs = Number.isFinite(baseMs) ? baseMs : Date.now();
  return new Date(safeBaseMs + days * 24 * 60 * 60 * 1000).toISOString();
}

export function isReviewWindowClosed(deadlineAt: string | null, nowMs = Date.now()): boolean {
  if (!deadlineAt) return false;
  const deadlineMs = Date.parse(deadlineAt);
  if (!Number.isFinite(deadlineMs)) return false;
  return nowMs > deadlineMs;
}

export function shouldRevealCounterpartyReview(
  hasBothReviews: boolean,
  deadlineAt: string | null,
  nowMs = Date.now()
): boolean {
  return hasBothReviews || isReviewWindowClosed(deadlineAt, nowMs);
}
