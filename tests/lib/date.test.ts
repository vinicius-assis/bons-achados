import { describe, it, expect } from "vitest";
import { startOfTodayInBrazil } from "@/lib/date";

describe("startOfTodayInBrazil", () => {
  it("returns midnight America/Sao_Paulo (03:00 UTC) for a time later that same day", () => {
    const now = new Date("2026-08-03T15:00:00.000Z"); // 12:00 in America/Sao_Paulo
    expect(startOfTodayInBrazil(now)).toEqual(new Date("2026-08-03T03:00:00.000Z"));
  });

  it("rolls back to the previous UTC date when it's still yesterday in Brazil", () => {
    const now = new Date("2026-08-03T01:00:00.000Z"); // 22:00 on Aug 2 in America/Sao_Paulo
    expect(startOfTodayInBrazil(now)).toEqual(new Date("2026-08-02T03:00:00.000Z"));
  });
});
