/** Safe unpaid-break duration in ms. Non-numeric or inverted ranges yield 0. */
export function unpaidBreakMs(startAt: unknown, endAt: unknown): number {
  const start = typeof startAt === 'number' ? startAt : Number(startAt);
  const end = typeof endAt === 'number' ? endAt : Number(endAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return end - start;
}
