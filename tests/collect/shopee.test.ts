import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/shopee/hubClient", () => ({ searchProducts: vi.fn() }));
vi.mock("@/lib/collect/persist", () => ({ persistItems: vi.fn() }));
vi.mock("@/lib/collect/searchTerms", () => ({ pickRandomSearchTerm: vi.fn().mockReturnValue("eletrônicos") }));

import { searchProducts, type ShopeeHubItem } from "@/lib/shopee/hubClient";
import { persistItems } from "@/lib/collect/persist";
import { mapShopeeItems, collectShopee } from "@/lib/collect/shopee";

function buildItem(overrides: Partial<ShopeeHubItem> = {}): ShopeeHubItem {
  return {
    itemId: "SP1",
    title: "Air Fryer 4L",
    price: 219.9,
    discount: 20,
    image: "https://img.example/2.jpg",
    affiliateLink: "https://s.shopee.com.br/abc",
    productLink: "https://shopee.com.br/product/1/2",
    shopName: "Loja X",
    commissionRate: "0.05",
    ratingStar: 4.7,
    ...overrides,
  };
}

describe("mapShopeeItems", () => {
  it("maps fields, always with a null oldPrice", () => {
    const result = mapShopeeItems([buildItem()]);

    expect(result).toEqual([
      {
        productId: "SP1",
        title: "Air Fryer 4L",
        affiliateLink: "https://s.shopee.com.br/abc",
        image: "https://img.example/2.jpg",
        price: 219.9,
        oldPrice: null,
        discount: 20,
      },
    ]);
  });
});

describe("collectShopee", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("samples a random term when none is given", async () => {
    vi.mocked(searchProducts).mockResolvedValue({ items: [], hasNextPage: false });

    await collectShopee();

    expect(searchProducts).toHaveBeenCalledWith("eletrônicos", 1);
  });

  it("uses the given term instead of sampling one", async () => {
    vi.mocked(searchProducts).mockResolvedValue({ items: [], hasNextPage: false });

    await collectShopee("air fryer");

    expect(searchProducts).toHaveBeenCalledWith("air fryer", 1);
  });

  it("pages until it has 50 items or hasNextPage is false", async () => {
    vi.mocked(searchProducts)
      .mockResolvedValueOnce({
        items: Array.from({ length: 20 }, (_, i) => buildItem({ itemId: `SP${i}` })),
        hasNextPage: true,
      })
      .mockResolvedValueOnce({
        items: Array.from({ length: 20 }, (_, i) => buildItem({ itemId: `SP${20 + i}` })),
        hasNextPage: true,
      })
      .mockResolvedValueOnce({
        items: Array.from({ length: 20 }, (_, i) => buildItem({ itemId: `SP${40 + i}` })),
        hasNextPage: true,
      });
    vi.mocked(persistItems).mockResolvedValue({ inserted: 50, skipped: 0 });

    const result = await collectShopee("eletrônicos");

    expect(searchProducts).toHaveBeenCalledTimes(3);
    expect(searchProducts).toHaveBeenNthCalledWith(1, "eletrônicos", 1);
    expect(searchProducts).toHaveBeenNthCalledWith(2, "eletrônicos", 2);
    expect(searchProducts).toHaveBeenNthCalledWith(3, "eletrônicos", 3);
    expect(result.attempted).toBe(50);
  });

  it("stops paging when hasNextPage is false", async () => {
    vi.mocked(searchProducts).mockResolvedValue({ items: [buildItem()], hasNextPage: false });
    vi.mocked(persistItems).mockResolvedValue({ inserted: 1, skipped: 0 });

    const result = await collectShopee("eletrônicos");

    expect(searchProducts).toHaveBeenCalledTimes(1);
    expect(result.attempted).toBe(1);
  });

  it("persists the mapped items and returns the counts from persistItems", async () => {
    vi.mocked(searchProducts).mockResolvedValue({ items: [buildItem()], hasNextPage: false });
    vi.mocked(persistItems).mockResolvedValue({ inserted: 1, skipped: 0 });

    const result = await collectShopee("eletrônicos");

    expect(persistItems).toHaveBeenCalledWith("SHOPEE", [expect.objectContaining({ productId: "SP1" })]);
    expect(result).toEqual({ attempted: 1, inserted: 1, skipped: 0 });
  });

  it("returns a collect_failed error without throwing on any error", async () => {
    vi.mocked(searchProducts).mockRejectedValue(new Error("boom"));

    const result = await collectShopee("eletrônicos");

    expect(result).toEqual({ attempted: 0, inserted: 0, skipped: 0, error: "collect_failed" });
  });
});
