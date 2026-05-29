/** playStop null/undefined = through last note (same as composer). */
export function effectivePlayStop(playStop, length) {
  if (length <= 0) return 0;
  if (playStop == null) return length;
  const n = Number(playStop);
  if (!Number.isFinite(n) || n <= 0) return length;
  return Math.min(n, length);
}

/** 1-based inclusive play range; playStop omitted/null means through last note. */
export function resolvePlayRange(playStart, playStop, length) {
  if (!length) return { from: 0, to: -1, noteCount: 0 };
  const start = Math.max(1, Math.min(Number(playStart) || 1, length));
  const stop = Math.max(start, effectivePlayStop(playStop, length));
  return { from: start - 1, to: stop - 1, noteCount: stop - start + 1 };
}

export function playRangeForSave(playStart, playStop, length) {
  const { from, to } = resolvePlayRange(playStart, playStop, length);
  return { playStart: from + 1, playStop: to + 1 };
}
