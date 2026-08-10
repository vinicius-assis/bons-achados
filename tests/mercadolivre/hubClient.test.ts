import { describe, it, expect, vi, afterEach } from "vitest";
import {
  searchAffiliateProducts,
  MercadoLivreSessionExpiredError,
} from "@/lib/mercadolivre/hubClient";

const session = { cookieHeader: "a=b; c=d", csrfToken: "token123" };

const FIXTURE_RESPONSE = {
  polycard_client_model: {
    polycards: [
      {
        metadata: {
          id: "MLB2766771378",
          url: "www.mercadolivre.com.br/creatina-1kg-suplemento/p/MLB18725310",
          url_params: "?pdp_filters=item_id%3AMLB2766771378",
        },
        pictures: {
          pictures: [{ id: "894230-MLA111390627295_052026" }],
        },
        components: [
          { type: "title", id: "title", title: { text: "Creatina 1kg Suplemento" } },
          {
            type: "review_compacted",
            id: "review_compacted",
            review_compacted: {
              values: [
                { key: "icon_star_fill", type: "icon" },
                { key: "label", type: "label", label: { text: "4.8" } },
                { key: "label2", type: "label", label: { text: "| +500mil vendidos" } },
              ],
            },
          },
          {
            type: "chip",
            id: "affiliates_commission_chip",
            chip: { label: { text: "25%" } },
          },
          {
            type: "price",
            id: "price",
            price: {
              previous_price: { value: 239.9, currency: "BRL" },
              current_price: { value: 65.9, currency: "BRL" },
              discount_label: { text: "72% OFF" },
            },
          },
        ],
      },
      {
        // A card with no discount and no picture, to exercise the optional fields.
        metadata: {
          id: "MLB9999999999",
          url: "www.mercadolivre.com.br/produto-sem-desconto/p/MLB1111111111",
          url_params: "",
        },
        pictures: { pictures: [] },
        components: [
          { type: "title", id: "title", title: { text: "Produto Sem Desconto" } },
          {
            type: "price",
            id: "price",
            price: { current_price: { value: 50 } },
          },
        ],
      },
    ],
  },
};

describe("searchAffiliateProducts", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends the given offset for pagination instead of defaulting to 0", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => FIXTURE_RESPONSE,
    } as Response);

    await searchAffiliateProducts("creatina", session, 30);

    expect(global.fetch).toHaveBeenCalledWith(
      "https://www.mercadolivre.com.br/affiliate-program/api/hub/search?is_affiliate=true&device=desktop",
      expect.objectContaining({
        body: JSON.stringify({
          search: "creatina",
          sort: "relevance",
          filters: [],
          offset: 30,
        }),
      })
    );
  });

  it("sends the given sort and filters instead of defaulting to relevance/empty", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => FIXTURE_RESPONSE,
    } as Response);

    await searchAffiliateProducts("creatina", session, 0, {
      sort: "lowest_price",
      filters: [{ id: "category", value: "MLB5726", name: "Eletrodomésticos" }],
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "https://www.mercadolivre.com.br/affiliate-program/api/hub/search?is_affiliate=true&device=desktop",
      expect.objectContaining({
        body: JSON.stringify({
          search: "creatina",
          sort: "lowest_price",
          filters: [{ id: "category", value: "MLB5726", name: "Eletrodomésticos" }],
          offset: 0,
        }),
      })
    );
  });

  it("sends the query, cookies, and csrf token, and returns parsed items", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => FIXTURE_RESPONSE,
    } as Response);

    const items = await searchAffiliateProducts("creatina", session);

    expect(global.fetch).toHaveBeenCalledWith(
      "https://www.mercadolivre.com.br/affiliate-program/api/hub/search?is_affiliate=true&device=desktop",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          cookie: "a=b; c=d",
          "x-csrf-token": "token123",
        }),
        body: JSON.stringify({
          search: "creatina",
          sort: "relevance",
          filters: [],
          offset: 0,
        }),
      })
    );

    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      itemId: "MLB2766771378",
      title: "Creatina 1kg Suplemento",
      price: 65.9,
      oldPrice: 239.9,
      discountLabel: "72% OFF",
      rating: 4.8,
      soldLabel: "+500mil vendidos",
      image: "https://http2.mlstatic.com/D_Q_NP_2X_894230-MLA111390627295_052026-AB.webp",
      permalink:
        "https://www.mercadolivre.com.br/creatina-1kg-suplemento/p/MLB18725310?pdp_filters=item_id%3AMLB2766771378",
      commissionLabel: "25%",
    });
    expect(items[1]).toEqual({
      itemId: "MLB9999999999",
      title: "Produto Sem Desconto",
      price: 50,
      oldPrice: null,
      discountLabel: null,
      rating: null,
      soldLabel: null,
      image: "",
      permalink: "https://www.mercadolivre.com.br/produto-sem-desconto/p/MLB1111111111",
      commissionLabel: null,
    });
  });

  it("throws MercadoLivreSessionExpiredError on a 403 response", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 403 } as Response);

    await expect(searchAffiliateProducts("creatina", session)).rejects.toThrow(
      MercadoLivreSessionExpiredError
    );
  });

  it("throws MercadoLivreSessionExpiredError on a 401 response", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401 } as Response);

    await expect(searchAffiliateProducts("creatina", session)).rejects.toThrow(
      MercadoLivreSessionExpiredError
    );
  });

  it("throws a generic error on other non-ok statuses", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 } as Response);

    await expect(searchAffiliateProducts("creatina", session)).rejects.toThrow(
      "Mercado Livre hub search failed: 500"
    );
  });

  it("throws MercadoLivreSessionExpiredError when the response body doesn't look like ML's shape at all", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ unexpected: "shape" }),
    } as Response);

    await expect(searchAffiliateProducts("creatina", session)).rejects.toThrow(
      MercadoLivreSessionExpiredError
    );
  });

  it("returns an empty array when polycard_client_model is present but polycards is missing", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ polycard_client_model: {} }),
    } as Response);

    await expect(searchAffiliateProducts("creatina", session)).resolves.toEqual([]);
  });

  it("returns an empty array when polycards is an empty array", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ polycard_client_model: { polycards: [] } }),
    } as Response);

    await expect(searchAffiliateProducts("creatina", session)).resolves.toEqual([]);
  });

  it("drops a malformed card and keeps the valid ones instead of throwing", async () => {
    const brokenCard = {
      metadata: { id: "MLB0000000000", url: "www.mercadolivre.com.br/broken" },
      pictures: { pictures: [] },
      components: [
        { type: "title", id: "title", title: { text: "Produto Quebrado" } },
        { type: "price", id: "price", price: {} },
      ],
    };
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        polycard_client_model: {
          polycards: [FIXTURE_RESPONSE.polycard_client_model.polycards[0], brokenCard],
        },
      }),
    } as Response);

    const items = await searchAffiliateProducts("creatina", session);

    expect(items).toHaveLength(1);
    expect(items[0].itemId).toBe("MLB2766771378");
  });

  it("passes an abort signal with a timeout to fetch", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => FIXTURE_RESPONSE,
    } as Response);

    await searchAffiliateProducts("creatina", session);

    expect(global.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });
});
