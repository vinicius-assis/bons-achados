import { describe, it, expect } from "vitest";
import { startOfTodayInBrazil, formatBrazilTime } from "@/lib/date";

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

describe("formatBrazilTime", () => {
  it("formats a UTC instant as HH:mm in America/Sao_Paulo", () => {
    const date = new Date("2026-08-07T17:32:00.000Z"); // 14:32 in America/Sao_Paulo (UTC-3)
    expect(formatBrazilTime(date)).toBe("14:32");
  });

  it("zero-pads single-digit hours and minutes", () => {
    const date = new Date("2026-08-07T12:05:00.000Z"); // 09:05 in America/Sao_Paulo
    expect(formatBrazilTime(date)).toBe("09:05");
  });

  it("rolls into the previous day in Brazil without affecting the time shown", () => {
    const date = new Date("2026-08-07T02:15:00.000Z"); // 23:15 on Aug 6 in America/Sao_Paulo
    expect(formatBrazilTime(date)).toBe("23:15");
  });
});
