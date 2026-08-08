import { describe, it, expect, vi, afterEach } from "vitest";
import { SEARCH_TERMS, pickRandomSearchTerm } from "@/lib/collect/searchTerms";

describe("SEARCH_TERMS", () => {
  it("has at least 15 generic e-commerce categories", () => {
    expect(SEARCH_TERMS.length).toBeGreaterThanOrEqual(15);
  });

  it("has no duplicate or empty entries", () => {
    expect(new Set(SEARCH_TERMS).size).toBe(SEARCH_TERMS.length);
    expect(SEARCH_TERMS.every((term) => term.trim().length > 0)).toBe(true);
  });
});

describe("pickRandomSearchTerm", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the first term when Math.random returns 0", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    expect(pickRandomSearchTerm()).toBe(SEARCH_TERMS[0]);
  });

  it("returns the last term when Math.random returns just under 1", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999999);
    expect(pickRandomSearchTerm()).toBe(SEARCH_TERMS[SEARCH_TERMS.length - 1]);
  });
});
