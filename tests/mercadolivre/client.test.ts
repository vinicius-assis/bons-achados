import { describe, it, expect, vi, afterEach } from "vitest";
import { MercadoLivreClient } from "@/lib/mercadolivre/client";

describe("MercadoLivreClient", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("searchProducts sends the access token as a Bearer header and returns parsed results", async () => {
    const mockResults = [
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
    ];
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: mockResults }),
    } as Response);

    const client = new MercadoLivreClient("test-token");
    const results = await client.searchProducts("echo dot");

    expect(results).toEqual(mockResults);
    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.mercadolibre.com/sites/MLB/search?q=echo%20dot&limit=20",
      { headers: { Authorization: "Bearer test-token" } }
    );
  });

  it("searchProducts returns an empty array when the response has no results array", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    } as Response);

    const client = new MercadoLivreClient("test-token");
    const results = await client.searchProducts("echo dot");

    expect(results).toEqual([]);
  });

  it("searchProducts throws when the API responds with an error status", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 } as Response);

    const client = new MercadoLivreClient("test-token");

    await expect(client.searchProducts("echo dot")).rejects.toThrow(
      "Mercado Livre search failed: 500"
    );
  });

  it("getItemReviews sends the access token as a Bearer header and returns rating and total", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ rating_average: 4.8, paging: { total: 24000 } }),
    } as Response);

    const client = new MercadoLivreClient("test-token");
    const reviews = await client.getItemReviews("MLB1");

    expect(reviews).toEqual({ rating_average: 4.8, total: 24000 });
    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.mercadolibre.com/reviews/item/MLB1",
      { headers: { Authorization: "Bearer test-token" } }
    );
  });

  it("getItemReviews returns zeros when the request fails", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 } as Response);

    const client = new MercadoLivreClient("test-token");
    const reviews = await client.getItemReviews("MLB1");

    expect(reviews).toEqual({ rating_average: 0, total: 0 });
  });
});
