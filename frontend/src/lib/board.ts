/** Pure helpers for the horizontal Kanban navigation (top scrollbar, chips and arrows).
 * They only compute positions: no DOM access, so they stay testable and cannot loop. */

/** Scroll position that brings `index` to the left edge, bounded by what the board can scroll. */
export function laneScrollTarget(
  offsets: number[],
  index: number,
  maxScroll: number,
) {
  if (!offsets.length) return 0;
  const clamped = Math.min(Math.max(index, 0), offsets.length - 1);
  return Math.min(Math.max(offsets[clamped], 0), Math.max(maxScroll, 0));
}

/** Column nearest to the left edge; the last one once the board is scrolled to its end. */
export function activeLane(
  offsets: number[],
  scrollLeft: number,
  maxScroll: number,
) {
  if (!offsets.length) return 0;
  if (maxScroll > 0 && scrollLeft >= maxScroll - 1) return offsets.length - 1;
  let best = 0;
  offsets.forEach((offset, index) => {
    if (Math.abs(offset - scrollLeft) < Math.abs(offsets[best] - scrollLeft))
      best = index;
  });
  return best;
}

export function stepLane(current: number, direction: -1 | 1, count: number) {
  if (count <= 0) return 0;
  return Math.min(Math.max(current + direction, 0), count - 1);
}

/** Copies the horizontal position; writes nothing when already aligned, so two linked
 * scrollers never echo each other. Returns whether the target was moved. */
export function mirrorScroll(
  source: { scrollLeft: number },
  target: { scrollLeft: number },
) {
  if (Math.abs(source.scrollLeft - target.scrollLeft) < 1) return false;
  target.scrollLeft = source.scrollLeft;
  return true;
}
