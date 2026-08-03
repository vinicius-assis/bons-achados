import { describe, it, expect } from "vitest";
import { categorize } from "@/lib/postdraft/categorize";

describe("categorize", () => {
  it("matches a suplemento keyword", () => {
    expect(categorize("Creatina 1kg Suplemento Monohidratada")).toBe("suplemento");
  });

  it("matches a roupa keyword", () => {
    expect(categorize("Calça Jeans Flare Feminina Cintura Alta")).toBe("roupa");
  });

  it("matches a casa keyword", () => {
    expect(categorize("Fritadeira Elétrica Air Fryer 5L")).toBe("casa");
  });

  it("is case- and accent-insensitive", () => {
    expect(categorize("AR CONDICIONADO COM SERÚM Facial")).toBe("beleza");
  });

  it("falls back to outro when nothing matches", () => {
    expect(categorize("Cabo USB-C 2 metros")).toBe("outro");
  });
});
