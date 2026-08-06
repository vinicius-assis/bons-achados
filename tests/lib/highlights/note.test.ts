import { describe, it, expect } from "vitest";
import { isValidNote, MIN_NOTE_LENGTH } from "@/lib/highlights/note";

describe("isValidNote", () => {
  it("rejects an empty string", () => {
    expect(isValidNote("")).toBe(false);
  });

  it("rejects a string shorter than the minimum after trimming", () => {
    expect(isValidNote("  curto  ")).toBe(false);
  });

  it("rejects a string that is only whitespace", () => {
    expect(isValidNote("               ")).toBe(false);
  });

  it("accepts a string at exactly the minimum length", () => {
    expect(isValidNote("x".repeat(MIN_NOTE_LENGTH))).toBe(true);
  });

  it("accepts a longer string with surrounding whitespace", () => {
    expect(isValidNote("  Testei e o som surpreende nessa faixa de preço.  ")).toBe(true);
  });
});
