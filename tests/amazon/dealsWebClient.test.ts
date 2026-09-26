import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  buildAffiliateLink,
  parseDealsProduct,
  fetchDealsPage,
  AmazonWebSessionError,
  __resetDealsWebPacerForTests,
} from "@/lib/amazon/dealsWebClient";

function buildProduct(overrides: Record<string, unknown> = {}) {
  return {
    asin: "B0FRJC5D97",
    title: "Soundbar Samsung HW-B650F 3.1 canais",
    image: { hiRes: { baseUrl: "https://m.media-amazon.com/images/I/31Cx8Z5IRdL", extension: "jpg" } },
    price: {
      priceToPay: { price: "1259.0" },
      basisPrice: { price: "1799.0" },
    },
    dealBadge: { label: { content: { fragments: [{ text: "30% off" }] } } },
    dealDetails: { state: "AVAILABLE", type: "BEST_DEAL" },
    ...overrides,
  };
}

describe("buildAffiliateLink", () => {
  it("builds a canonical /dp link carrying only the affiliate tag", () => {
    expect(buildAffiliateLink("B0FRJC5D97", "bonsachado041-20")).toBe(
      "https://www.amazon.com.br/dp/B0FRJC5D97?tag=bonsachado041-20"
    );
  });
});

describe("parseDealsProduct", () => {
  it("maps a deal with a strikethrough price", () => {
    expect(parseDealsProduct(buildProduct(), "tag-20")).toEqual({
      asin: "B0FRJC5D97",
      title: "Soundbar Samsung HW-B650F 3.1 canais",
      price: 1259,
      oldPrice: 1799,
      discount: 30,
      image: "https://m.media-amazon.com/images/I/31Cx8Z5IRdL.jpg",
      affiliateLink: "https://www.amazon.com.br/dp/B0FRJC5D97?tag=tag-20",
    });
  });

  it("falls back to the badge percentage when there is no strikethrough price", () => {
    const product = buildProduct({
      price: { priceToPay: { price: "2799.0" } },
      dealBadge: { label: { content: { fragments: [{ text: "3% off" }] } } },
    });
    const item = parseDealsProduct(product, "tag-20");
    expect(item?.oldPrice).toBeNull();
    expect(item?.discount).toBe(3);
  });

  it("returns a null discount when there is neither a strikethrough price nor a percentage badge", () => {
    const product = buildProduct({
      price: { priceToPay: { price: "7999.98" } },
      dealBadge: { label: { content: { fragments: [{ text: "Menor preço em 365 dias" }] } } },
    });
    const item = parseDealsProduct(product, "tag-20");
    expect(item?.discount).toBeNull();
  });

  it("handles a product with no dealBadge at all", () => {
    const item = parseDealsProduct(buildProduct({ dealBadge: undefined, price: { priceToPay: { price: "172.48" }, basisPrice: { price: "365.0" } } }), "tag-20");
    expect(item?.discount).toBe(53);
  });

  it("skips deals that are not AVAILABLE", () => {
    expect(parseDealsProduct(buildProduct({ dealDetails: { state: "EXPIRED" } }), "tag-20")).toBeNull();
  });

  it("skips products with a missing price or a malformed ASIN", () => {
    expect(parseDealsProduct(buildProduct({ price: {} }), "tag-20")).toBeNull();
    expect(parseDealsProduct(buildProduct({ asin: "../evil" }), "tag-20")).toBeNull();
  });
});

describe("fetchDealsPage", () => {
  beforeEach(() => {
    __resetDealsWebPacerForTests();
    process.env.AMAZON_AFFILIATE_TAG = "tag-20";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.AMAZON_AFFILIATE_TAG;
  });

  function mockResponse(init: { status?: number; contentType?: string; body?: unknown }) {
    const status = init.status ?? 200;
    global.fetch = vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers({ "content-type": init.contentType ?? "application/json" }),
      json: async () => init.body,
    } as Response);
  }

  it("sends the cookie and paging params, and returns parsed items plus nextIndex", async () => {
    mockResponse({ body: { nextIndex: 60, startIndex: 30, products: [buildProduct(), { asin: "bad" }] } });

    const page = await fetchDealsPage(30, "session-id=abc");

    expect(page.items).toHaveLength(1);
    expect(page.nextIndex).toBe(60);
    const [url, init] = vi.mocked(global.fetch).mock.calls[0];
    expect(String(url)).toContain("startIndex=30");
    expect(String(url)).toContain("pageSize=30");
    expect((init as RequestInit).headers).toMatchObject({ cookie: "session-id=abc" });
  });

  it("returns a null nextIndex when the page has no products", async () => {
    mockResponse({ body: { nextIndex: 90, products: [] } });
    expect((await fetchDealsPage(60, "session-id=abc")).nextIndex).toBeNull();
  });

  it("throws AmazonWebSessionError on 401/403", async () => {
    mockResponse({ status: 403 });
    await expect(fetchDealsPage(0, "session-id=abc")).rejects.toBeInstanceOf(AmazonWebSessionError);
  });

  it("throws AmazonWebSessionError when the response is HTML instead of JSON", async () => {
    mockResponse({ contentType: "text/html; charset=utf-8" });
    await expect(fetchDealsPage(0, "session-id=abc")).rejects.toBeInstanceOf(AmazonWebSessionError);
  });
});
