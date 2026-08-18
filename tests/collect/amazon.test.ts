import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/amazon/session", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/amazon/hubClient", async () => {
  const actual = await vi.importActual("@/lib/amazon/hubClient");
  return { ...actual, listDeals: vi.fn() };
});
vi.mock("@/lib/collect/persist", () => ({ persistItems: vi.fn() }));

import { getSession } from "@/lib/amazon/session";
import { listDeals, AmazonSessionExpiredError, type AmazonDealItem } from "@/lib/amazon/hubClient";
import { persistItems } from "@/lib/collect/persist";
import { mapAmazonItems, collectAmazon } from "@/lib/collect/amazon";

const session = { cookieHeader: "a=b" };

function buildItem(overrides: Partial<AmazonDealItem> = {}): AmazonDealItem {
  return {
    asin: "B01",
    title: "Fone Bluetooth",
    price: 129.9,
    oldPrice: 199.9,
    discountLabel: "35% off",
    image: "https://img.example/1.jpg",
    permalink: "https://www.amazon.com.br/dp/B01",
    affiliateLink: "https://www.amazon.com.br/dp/B01?tag=bonsachados0f-20",
    ...overrides,
  };
}

describe("mapAmazonItems", () => {
  it("maps fields and parses the discount label into a number", () => {
    const result = mapAmazonItems([buildItem()]);

    expect(result).toEqual([
      {
        productId: "B01",
        title: "Fone Bluetooth",
        affiliateLink: "https://www.amazon.com.br/dp/B01?tag=bonsachados0f-20",
        image: "https://img.example/1.jpg",
        price: 129.9,
        oldPrice: 199.9,
        discount: 35,
      },
    ]);
  });

  it("maps a null discountLabel to a null discount", () => {
    const result = mapAmazonItems([buildItem({ discountLabel: null })]);

    expect(result[0].discount).toBeNull();
  });
});

describe("collectAmazon", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns a no_session error without fetching when there's no saved session", async () => {
    vi.mocked(getSession).mockResolvedValue(null);

    const result = await collectAmazon();

    expect(listDeals).not.toHaveBeenCalled();
    expect(result).toEqual({ attempted: 0, inserted: 0, skipped: 0, error: "no_session" });
  });

  it("pages until it has 50 items using the API's own nextIndex", async () => {
    vi.mocked(getSession).mockResolvedValue(session);
    vi.mocked(listDeals)
      .mockResolvedValueOnce({
        items: Array.from({ length: 30 }, (_, i) => buildItem({ asin: `B${i}` })),
        nextIndex: 30,
      })
      .mockResolvedValueOnce({
        items: Array.from({ length: 30 }, (_, i) => buildItem({ asin: `B${30 + i}` })),
        nextIndex: 60,
      });
    vi.mocked(persistItems).mockResolvedValue({ inserted: 50, skipped: 0 });

    const result = await collectAmazon();

    expect(listDeals).toHaveBeenCalledTimes(2);
    expect(listDeals).toHaveBeenNthCalledWith(1, 0, session);
    expect(listDeals).toHaveBeenNthCalledWith(2, 30, session);
    expect(result.attempted).toBe(50);
  });

  it("stops paging when nextIndex is null", async () => {
    vi.mocked(getSession).mockResolvedValue(session);
    vi.mocked(listDeals).mockResolvedValue({ items: [buildItem()], nextIndex: null });
    vi.mocked(persistItems).mockResolvedValue({ inserted: 1, skipped: 0 });

    const result = await collectAmazon();

    expect(listDeals).toHaveBeenCalledTimes(1);
    expect(result.attempted).toBe(1);
  });

  it("persists the mapped items and returns the counts from persistItems", async () => {
    vi.mocked(getSession).mockResolvedValue(session);
    vi.mocked(listDeals).mockResolvedValue({ items: [buildItem()], nextIndex: null });
    vi.mocked(persistItems).mockResolvedValue({ inserted: 1, skipped: 0 });

    const result = await collectAmazon();

    expect(persistItems).toHaveBeenCalledWith("AMAZON", [expect.objectContaining({ productId: "B01" })]);
    expect(result).toEqual({ attempted: 1, inserted: 1, skipped: 0 });
  });

  it("returns a session_expired error without throwing when the session has expired", async () => {
    vi.mocked(getSession).mockResolvedValue(session);
    vi.mocked(listDeals).mockRejectedValue(new AmazonSessionExpiredError());

    const result = await collectAmazon();

    expect(result).toEqual({ attempted: 0, inserted: 0, skipped: 0, error: "session_expired" });
  });

  it("returns a collect_failed error without throwing on any other error", async () => {
    vi.mocked(getSession).mockResolvedValue(session);
    vi.mocked(listDeals).mockRejectedValue(new Error("boom"));

    const result = await collectAmazon();

    expect(result).toEqual({ attempted: 0, inserted: 0, skipped: 0, error: "collect_failed" });
  });
});
