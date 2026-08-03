import { describe, it, expect } from "vitest";
import { parseDiscountPercentage } from "@/lib/mercadolivre/discountLabel";

describe("parseDiscountPercentage", () => {
  it("extracts the number from a typical label", () => {
    expect(parseDiscountPercentage("-50%")).toBe(50);
  });

  it("extracts the number regardless of surrounding text", () => {
    expect(parseDiscountPercentage("25% OFF")).toBe(25);
  });

  it("returns null for a null label", () => {
    expect(parseDiscountPercentage(null)).toBeNull();
  });

  it("returns null when there is no digit in the label", () => {
    expect(parseDiscountPercentage("OFERTA")).toBeNull();
  });
});
