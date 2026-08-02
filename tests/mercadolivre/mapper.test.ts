import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mapToProductInput } from "@/lib/mercadolivre/mapper";
import type { MLSearchItem, MLReviews } from "@/lib/mercadolivre/client";

const item: MLSearchItem = {
  id: "MLB1",
  title: "Echo Dot 5ª Geração",
  price: 219,
  original_price: 399,
  thumbnail: "http://img.com/echo.jpg",
  permalink: "https://produto.mercadolivre.com.br/MLB1-echo-dot",
  category_id: "MLB1000",
  seller: { nickname: "AmazonLoja" },
  sold_quantity: 24000,
};

const reviews: MLReviews = { rating_average: 4.8, total: 24000 };

describe("mapToProductInput", () => {
  beforeEach(() => {
    process.env.ML_AFFILIATE_WORD = "bonsachados";
    process.env.ML_AFFILIATE_TOOL = "12345";
  });

  afterEach(() => {
    delete process.env.ML_AFFILIATE_WORD;
    delete process.env.ML_AFFILIATE_TOOL;
  });

  it("maps a Mercado Livre item into a ProductInput", () => {
    const result = mapToProductInput(item, reviews);

    expect(result).toEqual({
      marketplace: "MERCADO_LIVRE",
      source: "AUTO",
      productId: "MLB1",
      title: "Echo Dot 5ª Geração",
      description: null,
      price: 219,
      oldPrice: 399,
      discount: 45,
      rating: 4.8,
      reviews: 24000,
      image: "http://img.com/echo.jpg",
      affiliateLink:
        "https://produto.mercadolivre.com.br/MLB1-echo-dot?matt_word=bonsachados&matt_tool=12345",
      category: "MLB1000",
      seller: "AmazonLoja",
    });
  });

  it("returns null discount and oldPrice when there is no original price", () => {
    const result = mapToProductInput({ ...item, original_price: null }, reviews);
    expect(result.discount).toBeNull();
    expect(result.oldPrice).toBeNull();
  });

  it("throws when affiliate env vars are missing", () => {
    delete process.env.ML_AFFILIATE_WORD;
    expect(() => mapToProductInput(item, reviews)).toThrow(
      "Missing ML_AFFILIATE_WORD or ML_AFFILIATE_TOOL env vars"
    );
  });
});
