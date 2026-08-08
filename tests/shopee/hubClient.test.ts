import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/shopee/client", async () => {
  const actual = await vi.importActual("@/lib/shopee/client");
  return { ...actual, shopeeRequest: vi.fn() };
});

import { searchProducts } from "@/lib/shopee/hubClient";
import { shopeeRequest } from "@/lib/shopee/client";

const RAW_NODE = {
  itemId: 17979995178,
  commissionRate: "0.25",
  priceMin: "45.99",
  priceMax: "55.99",
  priceDiscountRate: 10,
  imageUrl: "https://cf.shopee.com.br/file/abc123",
  offerLink: "https://shope.ee/xxxxxxxx",
  productLink: "https://shopee.com.br/product/14318452/4058376611",
  productName: "IKEA starfish",
  shopName: "IKEA",
  ratingStar: "4.7",
};

describe("searchProducts", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns an empty result without calling shopeeRequest when keyword is blank", async () => {
    const result = await searchProducts("", 1);

    expect(result).toEqual({ items: [], hasNextPage: false });
    expect(shopeeRequest).not.toHaveBeenCalled();
  });

  it("returns an empty result when keyword is only whitespace", async () => {
    const result = await searchProducts("   ", 1);

    expect(result).toEqual({ items: [], hasNextPage: false });
    expect(shopeeRequest).not.toHaveBeenCalled();
  });

  it("sends keyword and page as GraphQL variables", async () => {
    vi.mocked(shopeeRequest).mockResolvedValue({
      productOfferV2: { nodes: [], pageInfo: { hasNextPage: false } },
    });

    await searchProducts("fone bluetooth", 2);

    expect(shopeeRequest).toHaveBeenCalledWith(
      expect.stringContaining("productOfferV2"),
      { keyword: "fone bluetooth", page: 2 }
    );
  });

  it("maps a raw node to a ShopeeHubItem", async () => {
    vi.mocked(shopeeRequest).mockResolvedValue({
      productOfferV2: { nodes: [RAW_NODE], pageInfo: { hasNextPage: true } },
    });

    const { items, hasNextPage } = await searchProducts("starfish", 1);

    expect(hasNextPage).toBe(true);
    expect(items).toEqual([
      {
        itemId: "17979995178",
        title: "IKEA starfish",
        price: 45.99,
        discount: 10,
        image: "https://cf.shopee.com.br/file/abc123",
        affiliateLink: "https://shope.ee/xxxxxxxx",
        productLink: "https://shopee.com.br/product/14318452/4058376611",
        shopName: "IKEA",
        commissionRate: "0.25",
        ratingStar: 4.7,
      },
    ]);
  });

  it("maps priceDiscountRate 0 to discount null", async () => {
    vi.mocked(shopeeRequest).mockResolvedValue({
      productOfferV2: {
        nodes: [{ ...RAW_NODE, priceDiscountRate: 0 }],
        pageInfo: { hasNextPage: false },
      },
    });

    const { items } = await searchProducts("starfish", 1);

    expect(items[0].discount).toBeNull();
  });

  it("drops a node with a non-numeric priceMin and keeps the valid ones", async () => {
    const broken = { ...RAW_NODE, itemId: 999, priceMin: "not-a-number" };
    vi.mocked(shopeeRequest).mockResolvedValue({
      productOfferV2: { nodes: [RAW_NODE, broken], pageInfo: { hasNextPage: false } },
    });

    const { items } = await searchProducts("starfish", 1);

    expect(items).toHaveLength(1);
    expect(items[0].itemId).toBe("17979995178");
  });

  it("drops a node missing productName", async () => {
    const broken = { ...RAW_NODE, itemId: 999, productName: undefined };
    vi.mocked(shopeeRequest).mockResolvedValue({
      productOfferV2: { nodes: [broken], pageInfo: { hasNextPage: false } },
    });

    const { items } = await searchProducts("starfish", 1);

    expect(items).toEqual([]);
  });

  it("drops a node with a missing imageUrl", async () => {
    const broken = { ...RAW_NODE, itemId: 999, imageUrl: undefined };
    vi.mocked(shopeeRequest).mockResolvedValue({
      productOfferV2: { nodes: [broken], pageInfo: { hasNextPage: false } },
    });

    const { items } = await searchProducts("starfish", 1);

    expect(items).toEqual([]);
  });

  it("drops a node with priceMin of 0", async () => {
    const broken = { ...RAW_NODE, itemId: 999, priceMin: "0" };
    vi.mocked(shopeeRequest).mockResolvedValue({
      productOfferV2: { nodes: [broken], pageInfo: { hasNextPage: false } },
    });

    const { items } = await searchProducts("starfish", 1);

    expect(items).toEqual([]);
  });

  it("drops a node with a null priceMin", async () => {
    const broken = { ...RAW_NODE, itemId: 999, priceMin: null };
    vi.mocked(shopeeRequest).mockResolvedValue({
      productOfferV2: { nodes: [broken], pageInfo: { hasNextPage: false } },
    });

    const { items } = await searchProducts("starfish", 1);

    expect(items).toEqual([]);
  });

  it("propagates a ShopeeApiError thrown by shopeeRequest", async () => {
    const { ShopeeApiError } = await vi.importActual<typeof import("@/lib/shopee/client")>(
      "@/lib/shopee/client"
    );
    vi.mocked(shopeeRequest).mockRejectedValue(new ShopeeApiError("boom", 10030));

    await expect(searchProducts("starfish", 1)).rejects.toThrow("boom");
  });
});
