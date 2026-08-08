import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/shopee/hubClient", () => ({ searchProducts: vi.fn() }));
vi.mock("@/lib/collect/persist", () => ({
  persistItems: vi.fn(),
  findHighlightsByProductIds: vi.fn(),
}));

import { GET } from "@/app/api/admin/shopee/search/route";
import { searchProducts } from "@/lib/shopee/hubClient";
import { persistItems, findHighlightsByProductIds } from "@/lib/collect/persist";
import { ADMIN_SESSION_COOKIE, createSessionToken } from "@/lib/adminSession";

function authHeader() {
  return { cookie: `${ADMIN_SESSION_COOKIE}=${createSessionToken()}` };
}

const shopeeItem = {
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
};
const highlightRow = { id: "hl1", marketplace: "SHOPEE", productId: "SP1" };

describe("GET /api/admin/shopee/search", () => {
  beforeEach(() => {
    process.env.ADMIN_USER = "admin";
    process.env.ADMIN_PASSWORD = "test-password";
  });
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.ADMIN_USER;
    delete process.env.ADMIN_PASSWORD;
  });

  it("returns 401 without calling searchProducts when unauthorized", async () => {
    const response = await GET(new NextRequest("http://localhost/api/admin/shopee/search"));

    expect(response.status).toBe(401);
    expect(searchProducts).not.toHaveBeenCalled();
  });

  it("searches, persists the mapped items, and returns the enriched pool rows plus hasNextPage", async () => {
    vi.mocked(searchProducts).mockResolvedValue({ items: [shopeeItem], hasNextPage: true });
    vi.mocked(findHighlightsByProductIds).mockResolvedValue([highlightRow] as never);

    const response = await GET(
      new NextRequest("http://localhost/api/admin/shopee/search?q=air+fryer&page=2", {
        headers: authHeader(),
      })
    );
    const body = await response.json();

    expect(searchProducts).toHaveBeenCalledWith("air fryer", 2);
    expect(persistItems).toHaveBeenCalledWith("SHOPEE", [expect.objectContaining({ productId: "SP1" })]);
    expect(findHighlightsByProductIds).toHaveBeenCalledWith("SHOPEE", ["SP1"]);
    expect(body).toEqual({ items: [highlightRow], hasNextPage: true });
  });

  it("defaults page to 1 and query to empty when not given", async () => {
    vi.mocked(searchProducts).mockResolvedValue({ items: [], hasNextPage: false });
    vi.mocked(findHighlightsByProductIds).mockResolvedValue([]);

    await GET(new NextRequest("http://localhost/api/admin/shopee/search", { headers: authHeader() }));

    expect(searchProducts).toHaveBeenCalledWith("", 1);
  });

  it("returns 502 on any error", async () => {
    vi.mocked(searchProducts).mockRejectedValue(new Error("boom"));

    const response = await GET(
      new NextRequest("http://localhost/api/admin/shopee/search", { headers: authHeader() })
    );

    expect(response.status).toBe(502);
  });
});
