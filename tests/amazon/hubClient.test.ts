import { describe, it, expect, vi, afterEach } from "vitest";
import { listDeals, AmazonSessionExpiredError } from "@/lib/amazon/hubClient";

const session = { cookieHeader: "a=b; c=d" };

const FIXTURE_RESPONSE = {
  nextIndex: 30,
  startIndex: 0,
  products: [
    {
      asin: "B0GQWF5JD1",
      title: "Apple iPhone 17 de 256 GB — Azul-névoa",
      link: "/Apple-iPhone-17-256-Azul-n%C3%A9voa/dp/B0GQWF5JD1",
      image: {
        hiRes: { baseUrl: "https://m.media-amazon.com/images/I/41j+Sdw2FhL", extension: "jpg" },
        lowRes: { baseUrl: "https://m.media-amazon.com/images/I/3150guuNEpL", extension: "jpg" },
      },
      price: {
        priceToPay: { label: "Preço da Oferta:", price: "5887.78", strikethrough: false },
        basisPrice: { label: "De:", price: "7999.0", strikethrough: true },
      },
      dealBadge: {
        label: { content: { fragments: [{ text: "26% off" }] }, color: "FFFFFF", backgroundColor: "CC0C39" },
      },
    },
    {
      // No dealBadge, no basisPrice, no image — exercises the optional fields.
      asin: "B0ZZZZZZZZ",
      title: "Produto Sem Desconto",
      link: "/dp/B0ZZZZZZZZ",
      image: {},
      price: {
        priceToPay: { label: "Preço:", price: "50", strikethrough: false },
      },
    },
  ],
};

describe("listDeals", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.AMAZON_AFFILIATE_TAG;
  });

  it("sends the given offset as startIndex", async () => {
    process.env.AMAZON_AFFILIATE_TAG = "bonsachados0f-20";
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => FIXTURE_RESPONSE,
    } as Response);

    await listDeals(30, session);

    const calledUrl = vi.mocked(global.fetch).mock.calls[0][0] as string;
    expect(calledUrl).toContain("startIndex=30");
  });

  it("sends the cookie header and returns parsed items with local affiliate links", async () => {
    process.env.AMAZON_AFFILIATE_TAG = "bonsachados0f-20";
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => FIXTURE_RESPONSE,
    } as Response);

    const { items, nextIndex } = await listDeals(0, session);

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("https://www.amazon.com.br/d2b/api/v1/products/search?"),
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ cookie: "a=b; c=d" }),
      })
    );

    expect(nextIndex).toBe(30);
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      asin: "B0GQWF5JD1",
      title: "Apple iPhone 17 de 256 GB — Azul-névoa",
      price: 5887.78,
      oldPrice: 7999.0,
      discountLabel: "26% off",
      image: "https://m.media-amazon.com/images/I/41j+Sdw2FhL.jpg",
      permalink: "https://www.amazon.com.br/Apple-iPhone-17-256-Azul-n%C3%A9voa/dp/B0GQWF5JD1",
      affiliateLink: "https://www.amazon.com.br/dp/B0GQWF5JD1?tag=bonsachados0f-20",
    });
    expect(items[1]).toEqual({
      asin: "B0ZZZZZZZZ",
      title: "Produto Sem Desconto",
      price: 50,
      oldPrice: null,
      discountLabel: null,
      image: "",
      permalink: "https://www.amazon.com.br/dp/B0ZZZZZZZZ",
      affiliateLink: "https://www.amazon.com.br/dp/B0ZZZZZZZZ?tag=bonsachados0f-20",
    });
  });

  it("throws AmazonSessionExpiredError on a 403 response", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 403 } as Response);

    await expect(listDeals(0, session)).rejects.toThrow(AmazonSessionExpiredError);
  });

  it("throws AmazonSessionExpiredError on a 401 response", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401 } as Response);

    await expect(listDeals(0, session)).rejects.toThrow(AmazonSessionExpiredError);
  });

  it("throws a generic error on other non-ok statuses", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 } as Response);

    await expect(listDeals(0, session)).rejects.toThrow("Amazon deals search failed: 500");
  });

  it("throws AmazonSessionExpiredError when the body doesn't have a products array", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ error: 90309999 }),
    } as Response);

    await expect(listDeals(0, session)).rejects.toThrow(AmazonSessionExpiredError);
  });

  it("returns an empty array when products is empty", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ nextIndex: null, products: [] }),
    } as Response);

    const { items, nextIndex } = await listDeals(0, session);

    expect(items).toEqual([]);
    expect(nextIndex).toBeNull();
  });

  it("drops a malformed product and keeps the valid ones instead of throwing", async () => {
    const broken = { asin: "B0BROKEN", title: null, price: {} };
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        nextIndex: 30,
        products: [FIXTURE_RESPONSE.products[0], broken],
      }),
    } as Response);

    const { items } = await listDeals(0, session);

    expect(items).toHaveLength(1);
    expect(items[0].asin).toBe("B0GQWF5JD1");
  });

  it("passes an abort signal with a timeout to fetch", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => FIXTURE_RESPONSE,
    } as Response);

    await listDeals(0, session);

    expect(global.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });
});
