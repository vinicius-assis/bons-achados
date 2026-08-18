import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/amazon/creatorsApiClient", () => ({
  fetchAccessToken: vi.fn(),
  searchItems: vi.fn(),
  getItems: vi.fn(),
  AmazonCreatorsApiError: class AmazonCreatorsApiError extends Error {
    rateLimited: boolean;
    constructor(message: string, rateLimited = false) {
      super(message);
      this.rateLimited = rateLimited;
    }
  },
}));
vi.mock("@/lib/collect/persist", () => ({ persistItems: vi.fn() }));
vi.mock("@/lib/collect/searchTerms", () => ({ pickRandomSearchTerm: vi.fn().mockReturnValue("eletrônicos") }));
vi.mock("@/lib/prisma", () => ({
  prisma: { highlight: { findMany: vi.fn().mockResolvedValue([]) } },
}));

import { fetchAccessToken, searchItems, AmazonCreatorsApiError, type AmazonDealItem } from "@/lib/amazon/creatorsApiClient";
import { persistItems } from "@/lib/collect/persist";
import { collectAmazon } from "@/lib/collect/amazon";

function buildItem(overrides: Partial<AmazonDealItem> = {}): AmazonDealItem {
  return {
    asin: "B01",
    title: "Fone Bluetooth",
    price: 129.9,
    oldPrice: 199.9,
    discount: 35,
    image: "https://img.example/1.jpg",
    affiliateLink: "https://www.amazon.com.br/dp/B01?tag=bonsachados0f-20",
    ...overrides,
  };
}

describe("collectAmazon", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("fetches a token, then pages searchItems until it has 50 items", async () => {
    vi.mocked(fetchAccessToken).mockResolvedValue("token-abc");
    vi.mocked(searchItems).mockImplementation(async (_term, page) =>
      Array.from({ length: 10 }, (_, i) => buildItem({ asin: `B${page}-${i}` }))
    );
    vi.mocked(persistItems).mockResolvedValue({ inserted: 50, skipped: 0 });

    const result = await collectAmazon();

    expect(searchItems).toHaveBeenCalledTimes(5);
    for (let page = 1; page <= 5; page++) {
      expect(searchItems).toHaveBeenNthCalledWith(page, "eletrônicos", page, "token-abc");
    }
    expect(result.attempted).toBe(50);
  });

  it("stops paging early when a page returns fewer than 10 items", async () => {
    vi.mocked(fetchAccessToken).mockResolvedValue("token-abc");
    vi.mocked(searchItems)
      .mockResolvedValueOnce(Array.from({ length: 10 }, (_, i) => buildItem({ asin: `B${i}` })))
      .mockResolvedValueOnce([buildItem({ asin: "B10" })]);
    vi.mocked(persistItems).mockResolvedValue({ inserted: 11, skipped: 0 });

    const result = await collectAmazon();

    expect(searchItems).toHaveBeenCalledTimes(2);
    expect(result.attempted).toBe(11);
  });

  it("persists the mapped items under the AMAZON marketplace", async () => {
    vi.mocked(fetchAccessToken).mockResolvedValue("token-abc");
    vi.mocked(searchItems).mockResolvedValueOnce([buildItem()]);
    vi.mocked(persistItems).mockResolvedValue({ inserted: 1, skipped: 0 });

    const result = await collectAmazon();

    expect(persistItems).toHaveBeenCalledWith("AMAZON", [
      expect.objectContaining({ productId: "B01", affiliateLink: "https://www.amazon.com.br/dp/B01?tag=bonsachados0f-20" }),
    ]);
    expect(result).toEqual({ attempted: 1, inserted: 1, skipped: 0 });
  });

  it("returns a collect_failed error without throwing when fetchAccessToken fails", async () => {
    vi.mocked(fetchAccessToken).mockRejectedValue(new Error("boom"));

    const result = await collectAmazon();

    expect(searchItems).not.toHaveBeenCalled();
    expect(result).toEqual({ attempted: 0, inserted: 0, skipped: 0, error: "collect_failed" });
  });

  it("returns a rate_limited error without throwing when searchItems is rate-limited", async () => {
    vi.mocked(fetchAccessToken).mockResolvedValue("token-abc");
    vi.mocked(searchItems).mockRejectedValue(new AmazonCreatorsApiError("rate limited", true));

    const result = await collectAmazon();

    expect(result).toEqual({ attempted: 0, inserted: 0, skipped: 0, error: "rate_limited" });
  });

  it("returns a collect_failed error without throwing on any other searchItems error", async () => {
    vi.mocked(fetchAccessToken).mockResolvedValue("token-abc");
    vi.mocked(searchItems).mockRejectedValue(new Error("boom"));

    const result = await collectAmazon();

    expect(result).toEqual({ attempted: 0, inserted: 0, skipped: 0, error: "collect_failed" });
  });
});
