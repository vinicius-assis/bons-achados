import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/shopee/hubClient", async () => {
  const actual = await vi.importActual("@/lib/shopee/hubClient");
  return { ...actual, searchProducts: vi.fn() };
});

import { GET } from "@/app/api/admin/shopee/search/route";
import { searchProducts } from "@/lib/shopee/hubClient";
import { ADMIN_SESSION_COOKIE, createSessionToken } from "@/lib/adminSession";

function authHeader() {
  return { cookie: `${ADMIN_SESSION_COOKIE}=${createSessionToken()}` };
}

const item = {
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
};

function buildRequest(query = "fone bluetooth", page?: number) {
  const url = new URL("http://localhost/api/admin/shopee/search");
  url.searchParams.set("q", query);
  if (page !== undefined) {
    url.searchParams.set("page", String(page));
  }
  return new NextRequest(url, { headers: authHeader() });
}

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

  it("returns 401 without calling searchProducts when the session cookie is missing or invalid", async () => {
    const request = new NextRequest("http://localhost/api/admin/shopee/search?q=fone");

    const response = await GET(request);

    expect(response.status).toBe(401);
    expect(searchProducts).not.toHaveBeenCalled();
  });

  it("returns items and hasNextPage from searchProducts", async () => {
    vi.mocked(searchProducts).mockResolvedValue({ items: [item], hasNextPage: true });

    const response = await GET(buildRequest());
    const body = await response.json();

    expect(searchProducts).toHaveBeenCalledWith("fone bluetooth", 1);
    expect(body).toEqual({ items: [item], hasNextPage: true });
  });

  it("passes the page query param through to searchProducts", async () => {
    vi.mocked(searchProducts).mockResolvedValue({ items: [item], hasNextPage: false });

    await GET(buildRequest("fone bluetooth", 3));

    expect(searchProducts).toHaveBeenCalledWith("fone bluetooth", 3);
  });

  it("defaults to page 1 when the page param is missing, zero, negative, or invalid", async () => {
    vi.mocked(searchProducts).mockResolvedValue({ items: [item], hasNextPage: false });

    await GET(buildRequest("fone bluetooth", -5));

    expect(searchProducts).toHaveBeenCalledWith("fone bluetooth", 1);
  });

  it("defaults the keyword to an empty string when q is missing", async () => {
    vi.mocked(searchProducts).mockResolvedValue({ items: [], hasNextPage: false });
    const request = new NextRequest("http://localhost/api/admin/shopee/search", {
      headers: authHeader(),
    });

    await GET(request);

    expect(searchProducts).toHaveBeenCalledWith("", 1);
  });

  it("returns 502 when searchProducts throws", async () => {
    vi.mocked(searchProducts).mockRejectedValue(new Error("boom"));

    const response = await GET(buildRequest());

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "search_failed" });
  });
});
