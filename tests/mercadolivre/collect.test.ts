import { describe, it, expect, vi, afterEach } from "vitest";
import { collectMercadoLivreDeals } from "@/lib/mercadolivre/collect";
import { MercadoLivreClient } from "@/lib/mercadolivre/client";

describe("collectMercadoLivreDeals", () => {
  afterEach(() => {
    delete process.env.ML_AFFILIATE_WORD;
    delete process.env.ML_AFFILIATE_TOOL;
  });

  it("searches every query and maps each result with its reviews", async () => {
    process.env.ML_AFFILIATE_WORD = "bonsachados";
    process.env.ML_AFFILIATE_TOOL = "12345";

    const client = new MercadoLivreClient();
    client.searchProducts = vi.fn().mockResolvedValue([
      {
        id: "MLB1",
        title: "Echo Dot",
        price: 219,
        original_price: 399,
        thumbnail: "http://img",
        permalink: "http://item",
        category_id: "MLB1000",
        seller: { nickname: "Loja" },
        sold_quantity: 500,
      },
    ]);
    client.getItemReviews = vi.fn().mockResolvedValue({ rating_average: 4.8, total: 24000 });

    const result = await collectMercadoLivreDeals(["echo dot"], client);

    expect(client.searchProducts).toHaveBeenCalledWith("echo dot");
    expect(client.getItemReviews).toHaveBeenCalledWith("MLB1");
    expect(result).toHaveLength(1);
    expect(result[0].productId).toBe("MLB1");
  });

  it("returns an empty array when no queries are given", async () => {
    const client = new MercadoLivreClient();
    const result = await collectMercadoLivreDeals([], client);
    expect(result).toEqual([]);
  });

  it("skips a failing query and still returns results from the others", async () => {
    process.env.ML_AFFILIATE_WORD = "bonsachados";
    process.env.ML_AFFILIATE_TOOL = "12345";

    const client = new MercadoLivreClient();
    client.searchProducts = vi
      .fn()
      .mockRejectedValueOnce(new Error("Mercado Livre search failed: 500"))
      .mockResolvedValueOnce([
        {
          id: "MLB2",
          title: "Fire TV Stick",
          price: 199,
          original_price: 349,
          thumbnail: "http://img2",
          permalink: "http://item2",
          category_id: "MLB1000",
          seller: { nickname: "Loja" },
          sold_quantity: 300,
        },
      ]);
    client.getItemReviews = vi.fn().mockResolvedValue({ rating_average: 4.5, total: 1000 });

    const result = await collectMercadoLivreDeals(["broken query", "fire tv"], client);

    expect(client.searchProducts).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(1);
    expect(result[0].productId).toBe("MLB2");
  });
});
