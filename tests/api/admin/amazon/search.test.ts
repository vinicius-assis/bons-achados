import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/amazon/creatorsApiClient", () => ({
  fetchAccessToken: vi.fn(),
  searchItems: vi.fn(),
  AmazonCreatorsApiError: class AmazonCreatorsApiError extends Error {
    rateLimited: boolean;
    constructor(message: string, rateLimited = false) {
      super(message);
      this.rateLimited = rateLimited;
    }
  },
}));
vi.mock("@/lib/collect/persist", () => ({
  persistItems: vi.fn(),
  findHighlightsByProductIds: vi.fn(),
}));

import { GET } from "@/app/api/admin/amazon/search/route";
import { fetchAccessToken, searchItems, AmazonCreatorsApiError } from "@/lib/amazon/creatorsApiClient";
import { persistItems, findHighlightsByProductIds } from "@/lib/collect/persist";
import { ADMIN_SESSION_COOKIE, createSessionToken } from "@/lib/adminSession";

function authHeader() {
  return { cookie: `${ADMIN_SESSION_COOKIE}=${createSessionToken()}` };
}

const dealItem = {
  asin: "B01",
  title: "Produto",
  price: 10,
  oldPrice: null,
  discount: null,
  image: "https://img.example/1.jpg",
  affiliateLink: "https://www.amazon.com.br/dp/B01?tag=bonsachados0f-20",
};

const highlightRow = { id: "hl1", marketplace: "AMAZON", productId: "B01" };

function buildRequest(params: Record<string, string> = {}) {
  const url = new URL("http://localhost/api/admin/amazon/search");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return new NextRequest(url, { headers: authHeader() });
}

describe("GET /api/admin/amazon/search", () => {
  beforeEach(() => {
    process.env.ADMIN_USER = "admin";
    process.env.ADMIN_PASSWORD = "test-password";
  });
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.ADMIN_USER;
    delete process.env.ADMIN_PASSWORD;
  });

  it("returns 401 without calling anything when unauthorized", async () => {
    const response = await GET(new NextRequest("http://localhost/api/admin/amazon/search"));

    expect(response.status).toBe(401);
    expect(fetchAccessToken).not.toHaveBeenCalled();
  });

  it("searches with q and page, persists results, returns the enriched pool rows", async () => {
    vi.mocked(fetchAccessToken).mockResolvedValue("token-abc");
    vi.mocked(searchItems).mockResolvedValue([dealItem]);
    vi.mocked(findHighlightsByProductIds).mockResolvedValue([highlightRow] as never);

    const response = await GET(buildRequest({ q: "fone bluetooth", page: "2" }));
    const body = await response.json();

    expect(searchItems).toHaveBeenCalledWith("fone bluetooth", 2, "token-abc", {});
    expect(persistItems).toHaveBeenCalledWith("AMAZON", [expect.objectContaining({ productId: "B01" })]);
    expect(findHighlightsByProductIds).toHaveBeenCalledWith("AMAZON", ["B01"]);
    expect(body).toEqual({ items: [highlightRow] });
  });

  it("defaults page to 1 when missing", async () => {
    vi.mocked(fetchAccessToken).mockResolvedValue("token-abc");
    vi.mocked(searchItems).mockResolvedValue([]);
    vi.mocked(findHighlightsByProductIds).mockResolvedValue([]);

    await GET(buildRequest({ q: "fone" }));

    expect(searchItems).toHaveBeenCalledWith("fone", 1, "token-abc", {});
  });

  it("passes each filter through when present, and omits filters that are absent", async () => {
    vi.mocked(fetchAccessToken).mockResolvedValue("token-abc");
    vi.mocked(searchItems).mockResolvedValue([]);
    vi.mocked(findHighlightsByProductIds).mockResolvedValue([]);

    await GET(
      buildRequest({
        q: "fone",
        searchIndex: "Electronics",
        sortBy: "Price:LowToHigh",
        brand: "Sony",
        minPrice: "1000",
        maxPrice: "500000",
        prime: "true",
      })
    );

    expect(searchItems).toHaveBeenCalledWith("fone", 1, "token-abc", {
      searchIndex: "Electronics",
      sortBy: "Price:LowToHigh",
      brand: "Sony",
      minPrice: 1000,
      maxPrice: 500000,
      prime: true,
    });
  });

  it("omits minPrice/maxPrice entirely when given non-numeric values, instead of sending NaN", async () => {
    vi.mocked(fetchAccessToken).mockResolvedValue("token-abc");
    vi.mocked(searchItems).mockResolvedValue([]);
    vi.mocked(findHighlightsByProductIds).mockResolvedValue([]);

    await GET(buildRequest({ q: "fone", minPrice: "abc", maxPrice: "xyz" }));

    const filtersArg = vi.mocked(searchItems).mock.calls[0][3];
    expect(filtersArg).not.toHaveProperty("minPrice");
    expect(filtersArg).not.toHaveProperty("maxPrice");
    expect(searchItems).toHaveBeenCalledWith("fone", 1, "token-abc", {});
  });

  it("returns 429 rate_limited when the Creators API rate-limits the request", async () => {
    vi.mocked(fetchAccessToken).mockResolvedValue("token-abc");
    vi.mocked(searchItems).mockRejectedValue(new AmazonCreatorsApiError("rate limited", true));

    const response = await GET(buildRequest({ q: "fone" }));
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(body).toEqual({ error: "rate_limited" });
  });

  it("returns 502 on any other error", async () => {
    vi.mocked(fetchAccessToken).mockRejectedValue(new Error("boom"));

    const response = await GET(buildRequest({ q: "fone" }));

    expect(response.status).toBe(502);
  });
});
