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
  prisma: { highlight: { findMany: vi.fn().mockResolvedValue([]), update: vi.fn() } },
}));

import { fetchAccessToken, searchItems, getItems, AmazonCreatorsApiError, type AmazonDealItem } from "@/lib/amazon/creatorsApiClient";
import { persistItems } from "@/lib/collect/persist";
import { collectAmazon, refreshAmazonPrices } from "@/lib/collect/amazon";
import { prisma } from "@/lib/prisma";

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

  it("surfaces refreshAmazonPrices' error on the result when discovery itself succeeded", async () => {
    vi.mocked(fetchAccessToken).mockResolvedValue("token-abc");
    vi.mocked(searchItems).mockResolvedValueOnce([buildItem()]);
    vi.mocked(persistItems).mockResolvedValue({ inserted: 1, skipped: 0 });
    // refreshAmazonPrices() internals: a stale row exists and its batch is rate-limited.
    vi.mocked(prisma.highlight.findMany).mockResolvedValue([{ id: "hl0", productId: "B0" }] as never);
    vi.mocked(getItems).mockRejectedValue(new AmazonCreatorsApiError("rate limited", true));

    const result = await collectAmazon();

    expect(result).toEqual({ attempted: 1, inserted: 1, skipped: 0, error: "rate_limited" });
  });

  it("does not overwrite a real discovery error with a refresh error", async () => {
    vi.mocked(fetchAccessToken).mockResolvedValue("token-abc");
    vi.mocked(searchItems).mockRejectedValue(new Error("boom"));
    // refreshAmazonPrices() would also fail, but discovery's error must win.
    vi.mocked(prisma.highlight.findMany).mockResolvedValue([{ id: "hl0", productId: "B0" }] as never);
    vi.mocked(getItems).mockRejectedValue(new AmazonCreatorsApiError("rate limited", true));

    const result = await collectAmazon();

    expect(result).toEqual({ attempted: 0, inserted: 0, skipped: 0, error: "collect_failed" });
  });

  it("still returns the discovery counts even when refreshAmazonPrices' own initial query fails", async () => {
    // refreshAmazonPrices() wraps its stale-rows query in try/catch (Fix 3), so it
    // never actually throws — this confirms collectAmazon() survives that failure
    // end-to-end and still reports the successful discovery numbers, merging in
    // refresh's own error rather than losing the whole result.
    vi.mocked(fetchAccessToken).mockResolvedValue("token-abc");
    vi.mocked(searchItems).mockResolvedValueOnce([buildItem()]);
    vi.mocked(persistItems).mockResolvedValue({ inserted: 1, skipped: 0 });
    vi.mocked(prisma.highlight.findMany).mockRejectedValue(new Error("totally unexpected"));

    const result = await collectAmazon();

    expect(result).toEqual({ attempted: 1, inserted: 1, skipped: 0, error: "collect_failed" });
  });
});

describe("refreshAmazonPrices", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("does nothing and doesn't call fetchAccessToken when there are no stale items", async () => {
    vi.mocked(prisma.highlight.findMany).mockResolvedValue([]);

    const result = await refreshAmazonPrices();

    expect(fetchAccessToken).not.toHaveBeenCalled();
    expect(result).toEqual({ refreshed: 0 });
  });

  it("queries only AMAZON highlights with updatedAt older than 50 minutes", async () => {
    vi.mocked(prisma.highlight.findMany).mockResolvedValue([]);

    await refreshAmazonPrices();

    expect(prisma.highlight.findMany).toHaveBeenCalledWith({
      where: {
        marketplace: "AMAZON",
        updatedAt: { lt: expect.any(Date) },
      },
      select: { id: true, productId: true },
    });
  });

  it("batches ASINs in groups of 10 and updates matching rows", async () => {
    const staleRows = Array.from({ length: 15 }, (_, i) => ({ id: `hl${i}`, productId: `B${i}` }));
    vi.mocked(prisma.highlight.findMany).mockResolvedValue(staleRows as never);
    vi.mocked(fetchAccessToken).mockResolvedValue("token-abc");
    vi.mocked(getItems).mockImplementation(async (asins) =>
      asins.map((asin) => ({
        asin,
        title: "irrelevant",
        price: 42,
        oldPrice: 50,
        discount: 16,
        image: "irrelevant",
        affiliateLink: "irrelevant",
      }))
    );
    vi.mocked(prisma.highlight.update).mockResolvedValue({} as never);

    const result = await refreshAmazonPrices();

    expect(getItems).toHaveBeenCalledTimes(2);
    expect(getItems).toHaveBeenNthCalledWith(1, staleRows.slice(0, 10).map((r) => r.productId), "token-abc");
    expect(getItems).toHaveBeenNthCalledWith(2, staleRows.slice(10).map((r) => r.productId), "token-abc");
    expect(prisma.highlight.update).toHaveBeenCalledTimes(15);
    expect(prisma.highlight.update).toHaveBeenCalledWith({
      where: { id: "hl0" },
      data: { price: 42, oldPrice: 50, discount: 16 },
    });
    expect(result).toEqual({ refreshed: 15 });
  });

  it("skips rows whose ASIN isn't in the GetItems response instead of failing", async () => {
    vi.mocked(prisma.highlight.findMany).mockResolvedValue([
      { id: "hl0", productId: "B0" },
      { id: "hl1", productId: "B1" },
    ] as never);
    vi.mocked(fetchAccessToken).mockResolvedValue("token-abc");
    vi.mocked(getItems).mockResolvedValue([
      { asin: "B0", title: "x", price: 10, oldPrice: null, discount: null, image: "x", affiliateLink: "x" },
    ]);
    vi.mocked(prisma.highlight.update).mockResolvedValue({} as never);

    const result = await refreshAmazonPrices();

    // One update for the fresh price row, one for bumping the missing row's updatedAt.
    expect(prisma.highlight.update).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ refreshed: 1 });
  });

  it("bumps updatedAt (without touching price fields) for a stale row whose ASIN is delisted", async () => {
    vi.mocked(prisma.highlight.findMany).mockResolvedValue([
      { id: "hl0", productId: "B0" },
      { id: "hl1", productId: "B1-delisted" },
    ] as never);
    vi.mocked(fetchAccessToken).mockResolvedValue("token-abc");
    vi.mocked(getItems).mockResolvedValue([
      { asin: "B0", title: "x", price: 10, oldPrice: null, discount: null, image: "x", affiliateLink: "x" },
    ]);
    vi.mocked(prisma.highlight.update).mockResolvedValue({} as never);

    await refreshAmazonPrices();

    expect(prisma.highlight.update).toHaveBeenCalledWith({
      where: { id: "hl1" },
      data: { updatedAt: expect.any(Date) },
    });
    // Make sure the bump call didn't sneak in price/oldPrice/discount.
    const bumpCall = vi.mocked(prisma.highlight.update).mock.calls.find((call) => call[0].where.id === "hl1");
    expect(bumpCall?.[0].data).not.toHaveProperty("price");
    expect(bumpCall?.[0].data).not.toHaveProperty("oldPrice");
    expect(bumpCall?.[0].data).not.toHaveProperty("discount");
  });

  it("returns a collect_failed error without throwing when fetchAccessToken fails", async () => {
    vi.mocked(prisma.highlight.findMany).mockResolvedValue([{ id: "hl0", productId: "B0" }] as never);
    vi.mocked(fetchAccessToken).mockRejectedValue(new Error("boom"));

    const result = await refreshAmazonPrices();

    expect(result).toEqual({ refreshed: 0, error: "collect_failed" });
  });

  it("continues remaining batches when one batch's getItems call fails with a non-rate-limited error, and reports refresh_failed", async () => {
    const staleRows = Array.from({ length: 15 }, (_, i) => ({ id: `hl${i}`, productId: `B${i}` }));
    vi.mocked(prisma.highlight.findMany).mockResolvedValue(staleRows as never);
    vi.mocked(fetchAccessToken).mockResolvedValue("token-abc");
    vi.mocked(getItems)
      .mockRejectedValueOnce(new Error("boom"))
      .mockImplementationOnce(async (asins) =>
        asins.map((asin) => ({ asin, title: "x", price: 10, oldPrice: null, discount: null, image: "x", affiliateLink: "x" }))
      );
    vi.mocked(prisma.highlight.update).mockResolvedValue({} as never);

    const result = await refreshAmazonPrices();

    expect(getItems).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ refreshed: 5, error: "refresh_failed" });
  });

  it("stops processing further batches and reports rate_limited when a batch is rate-limited", async () => {
    const staleRows = Array.from({ length: 25 }, (_, i) => ({ id: `hl${i}`, productId: `B${i}` }));
    vi.mocked(prisma.highlight.findMany).mockResolvedValue(staleRows as never);
    vi.mocked(fetchAccessToken).mockResolvedValue("token-abc");
    vi.mocked(getItems)
      .mockImplementationOnce(async (asins) =>
        asins.map((asin) => ({ asin, title: "x", price: 10, oldPrice: null, discount: null, image: "x", affiliateLink: "x" }))
      )
      .mockRejectedValueOnce(new AmazonCreatorsApiError("rate limited", true));
    vi.mocked(prisma.highlight.update).mockResolvedValue({} as never);

    const result = await refreshAmazonPrices();

    // 3 batches of 10 total, but the loop must stop after the 2nd batch's
    // rate-limited failure — the 3rd batch's getItems must never be called.
    expect(getItems).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ refreshed: 10, error: "rate_limited" });
  });

  it("returns a CollectResult (not a thrown error) when the initial stale-rows query fails", async () => {
    vi.mocked(prisma.highlight.findMany).mockRejectedValue(new Error("db down"));

    const result = await refreshAmazonPrices();

    expect(fetchAccessToken).not.toHaveBeenCalled();
    expect(result).toEqual({ refreshed: 0, error: "collect_failed" });
  });
});
