import { describe, it, expect, vi, afterEach } from "vitest";
import { detectMarketplace, extractProductId } from "@/lib/manualItems/detectMarketplace";

describe("detectMarketplace", () => {
  it("detects Mercado Livre from a meli.la link", () => {
    expect(detectMarketplace("https://meli.la/abc123")).toBe("MERCADO_LIVRE");
  });

  it("detects Shopee from a s.shopee.com.br link", () => {
    expect(detectMarketplace("https://s.shopee.com.br/3LqZ9x8y")).toBe("SHOPEE");
  });

  it("detects Amazon from a /dp/ link", () => {
    expect(detectMarketplace("https://www.amazon.com.br/dp/B08N5WRWNW?tag=meutag-20")).toBe(
      "AMAZON"
    );
  });

  it("returns null for a link that matches none of the patterns", () => {
    expect(detectMarketplace("https://example.com/produto/123")).toBeNull();
  });

  it("returns null for an amazon.com.br link without /dp/", () => {
    expect(detectMarketplace("https://www.amazon.com.br/gp/product/B08N5WRWNW")).toBeNull();
  });
});

describe("extractProductId", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("extracts the ASIN from an Amazon link", () => {
    expect(extractProductId("AMAZON", "https://www.amazon.com.br/dp/B08N5WRWNW?tag=x")).toBe(
      "B08N5WRWNW"
    );
  });

  it("extracts the short code from a Shopee link", () => {
    expect(extractProductId("SHOPEE", "https://s.shopee.com.br/3LqZ9x8y")).toBe("3LqZ9x8y");
  });

  it("extracts the slug from a Mercado Livre link", () => {
    expect(extractProductId("MERCADO_LIVRE", "https://meli.la/abc123")).toBe("abc123");
  });

  it("strips query strings and trailing slashes when extracting", () => {
    expect(extractProductId("SHOPEE", "https://s.shopee.com.br/3LqZ9x8y?utm=x")).toBe("3LqZ9x8y");
  });

  it("falls back to a random id when the recognized link has no extractable id", () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue("11111111-1111-1111-1111-111111111111");
    expect(extractProductId("AMAZON", "https://www.amazon.com.br/dp/")).toBe(
      "11111111-1111-1111-1111-111111111111"
    );
  });
});
