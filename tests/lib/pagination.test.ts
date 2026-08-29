import { describe, it, expect } from "vitest";

import { buildPageWindow } from "@/lib/pagination";

const render = (current: number, totalPages: number): string =>
  buildPageWindow(current, totalPages)
    .map((item) => (item.type === "ellipsis" ? "..." : String(item.page)))
    .join(" ");

describe("buildPageWindow", () => {
  it("lists every page when they all fit without gaps", () => {
    expect(render(1, 3)).toBe("1 2 3");
  });

  it("collapses the gap after the window into a single ellipsis", () => {
    expect(render(1, 10)).toBe("1 2 ... 10");
  });

  it("puts an ellipsis on both sides of a mid-range window", () => {
    expect(render(6, 10)).toBe("1 ... 5 6 7 ... 10");
  });

  it("collapses only the leading gap when the window reaches the end", () => {
    expect(render(9, 10)).toBe("1 ... 8 9 10");
  });

  it("returns just the single page when there is one", () => {
    expect(render(1, 1)).toBe("1");
  });

  it("shows the number instead of an ellipsis for a gap of exactly one page", () => {
    expect(render(4, 7)).toBe("1 2 3 4 5 6 7");
  });

  it("never emits consecutive ellipses", () => {
    const items = buildPageWindow(50, 100);
    for (let i = 1; i < items.length; i++) {
      expect(items[i].type === "ellipsis" && items[i - 1].type === "ellipsis").toBe(false);
    }
  });

  it("does not break when current is past the last page", () => {
    expect(render(99, 10)).toBe("1 ... 10");
  });

  it("does not break when current is below the first page", () => {
    expect(render(0, 5)).toBe("1 ... 5");
  });

  it("treats a totalPages below 1 as a single page", () => {
    expect(render(1, 0)).toBe("1");
  });
});
