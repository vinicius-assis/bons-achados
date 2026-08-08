import { describe, it, expect, vi, afterEach } from "vitest";
import { NOTE_TEMPLATES, pickRandomNote } from "@/lib/highlights/noteTemplates";
import { isValidNote } from "@/lib/highlights/note";

describe("NOTE_TEMPLATES", () => {
  it("has at least 50 entries", () => {
    expect(NOTE_TEMPLATES.length).toBeGreaterThanOrEqual(50);
  });

  it("every entry is a valid note on its own (mín. 15 chars)", () => {
    for (const note of NOTE_TEMPLATES) {
      expect(isValidNote(note)).toBe(true);
    }
  });

  it("has no duplicate entries", () => {
    expect(new Set(NOTE_TEMPLATES).size).toBe(NOTE_TEMPLATES.length);
  });
});

describe("pickRandomNote", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the first template when Math.random returns 0", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    expect(pickRandomNote()).toBe(NOTE_TEMPLATES[0]);
  });

  it("returns the last template when Math.random returns just under 1", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999999);
    expect(pickRandomNote()).toBe(NOTE_TEMPLATES[NOTE_TEMPLATES.length - 1]);
  });
});
