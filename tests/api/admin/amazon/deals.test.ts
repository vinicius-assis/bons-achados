import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/amazon/session", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/amazon/hubClient", async () => {
  const actual = await vi.importActual("@/lib/amazon/hubClient");
  return { ...actual, listDeals: vi.fn() };
});
vi.mock("@/lib/collect/persist", () => ({
  persistItems: vi.fn(),
  findHighlightsByProductIds: vi.fn(),
}));

import { GET } from "@/app/api/admin/amazon/deals/route";
import { getSession } from "@/lib/amazon/session";
import { listDeals, AmazonSessionExpiredError } from "@/lib/amazon/hubClient";
import { persistItems, findHighlightsByProductIds } from "@/lib/collect/persist";
import { ADMIN_SESSION_COOKIE, createSessionToken } from "@/lib/adminSession";

function authHeader() {
  return { cookie: `${ADMIN_SESSION_COOKIE}=${createSessionToken()}` };
}

const dealItem = {
  asin: "B0GQWF5JD1",
  title: "Produto",
  price: 10,
  oldPrice: null,
  discountLabel: null,
  image: "https://img.example/1.jpg",
  permalink: "https://www.amazon.com.br/dp/B0GQWF5JD1",
  affiliateLink: "https://www.amazon.com.br/dp/B0GQWF5JD1?tag=bonsachados0f-20",
};

const highlightRow = { id: "hl1", marketplace: "AMAZON", productId: "B0GQWF5JD1" };

function buildRequest(offset?: number) {
  const url = new URL("http://localhost/api/admin/amazon/deals");
  if (offset !== undefined) {
    url.searchParams.set("offset", String(offset));
  }
  return new NextRequest(url, { headers: authHeader() });
}

describe("GET /api/admin/amazon/deals", () => {
  beforeEach(() => {
    process.env.ADMIN_USER = "admin";
    process.env.ADMIN_PASSWORD = "test-password";
  });
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.ADMIN_USER;
    delete process.env.ADMIN_PASSWORD;
  });

  it("returns 401 without calling any library functions when the session cookie is missing or invalid", async () => {
    const response = await GET(new NextRequest("http://localhost/api/admin/amazon/deals"));

    expect(response.status).toBe(401);
    expect(getSession).not.toHaveBeenCalled();
    expect(listDeals).not.toHaveBeenCalled();
  });

  it("returns 401 session_expired when no session is stored", async () => {
    vi.mocked(getSession).mockResolvedValue(null);

    const response = await GET(buildRequest());
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: "session_expired" });
    expect(listDeals).not.toHaveBeenCalled();
  });

  it("persists the fetched items and returns the enriched pool rows plus nextIndex", async () => {
    vi.mocked(getSession).mockResolvedValue({ cookieHeader: "a=b" });
    vi.mocked(listDeals).mockResolvedValue({ items: [dealItem], nextIndex: 30 });
    vi.mocked(findHighlightsByProductIds).mockResolvedValue([highlightRow] as never);

    const response = await GET(buildRequest());
    const body = await response.json();

    expect(listDeals).toHaveBeenCalledWith(0, { cookieHeader: "a=b" });
    expect(persistItems).toHaveBeenCalledWith(
      "AMAZON",
      [expect.objectContaining({ productId: "B0GQWF5JD1" })]
    );
    expect(findHighlightsByProductIds).toHaveBeenCalledWith("AMAZON", ["B0GQWF5JD1"]);
    expect(body).toEqual({ items: [highlightRow], nextIndex: 30 });
  });

  it("passes the offset query param through to listDeals for pagination", async () => {
    vi.mocked(getSession).mockResolvedValue({ cookieHeader: "a=b" });
    vi.mocked(listDeals).mockResolvedValue({ items: [], nextIndex: 60 });
    vi.mocked(findHighlightsByProductIds).mockResolvedValue([]);

    await GET(buildRequest(30));

    expect(listDeals).toHaveBeenCalledWith(30, { cookieHeader: "a=b" });
  });

  it("defaults to offset 0 when the offset param is missing, negative, or invalid", async () => {
    vi.mocked(getSession).mockResolvedValue({ cookieHeader: "a=b" });
    vi.mocked(listDeals).mockResolvedValue({ items: [], nextIndex: 30 });
    vi.mocked(findHighlightsByProductIds).mockResolvedValue([]);

    await GET(buildRequest(-5));

    expect(listDeals).toHaveBeenCalledWith(0, { cookieHeader: "a=b" });
  });

  it("returns 401 session_expired when the client throws AmazonSessionExpiredError", async () => {
    vi.mocked(getSession).mockResolvedValue({ cookieHeader: "a=b" });
    vi.mocked(listDeals).mockRejectedValue(new AmazonSessionExpiredError());

    const response = await GET(buildRequest());
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: "session_expired" });
  });

  it("returns 502 on any other error", async () => {
    vi.mocked(getSession).mockResolvedValue({ cookieHeader: "a=b" });
    vi.mocked(listDeals).mockRejectedValue(new Error("boom"));

    const response = await GET(buildRequest());

    expect(response.status).toBe(502);
  });
});
