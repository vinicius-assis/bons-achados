export type PageWindowItem = { type: "page"; page: number } | { type: "ellipsis" };

/**
 * Builds a Google-style pager window: always the first and last page, plus the
 * page before/after the current one, with a single ellipsis standing in for any
 * gap wider than one page (a gap of exactly one page shows the number instead).
 */
export function buildPageWindow(current: number, totalPages: number): PageWindowItem[] {
  const total = Math.max(1, Math.floor(totalPages));

  const pages = new Set<number>([1, total]);
  for (let page = Math.floor(current) - 1; page <= Math.floor(current) + 1; page++) {
    if (page >= 1 && page <= total) {
      pages.add(page);
    }
  }

  const sorted = [...pages].sort((a, b) => a - b);
  const items: PageWindowItem[] = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0) {
      const gap = sorted[i] - sorted[i - 1];
      if (gap === 2) {
        items.push({ type: "page", page: sorted[i - 1] + 1 });
      } else if (gap > 2) {
        items.push({ type: "ellipsis" });
      }
    }
    items.push({ type: "page", page: sorted[i] });
  }
  return items;
}
