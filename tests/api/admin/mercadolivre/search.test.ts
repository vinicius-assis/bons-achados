import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/mercadolivre/session", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/mercadolivre/hubClient", async () => {
  const actual = await vi.importActual("@/lib/mercadolivre/hubClient");
  return { ...actual, searchAffiliateProducts: vi.fn() };
});
vi.mock("@/lib/collect/mercadolivre", () => ({ mapMercadoLivreItems: vi.fn() }));
vi.mock("@/lib/collect/persist", () => ({
  persistItems: vi.fn(),
  findHighlightsByProductIds: vi.fn(),
}));

import { GET } from "@/app/api/admin/mercadolivre/search/route";
import { getSession } from "@/lib/mercadolivre/session";
import { searchAffiliateProducts, MercadoLivreSessionExpiredError } from "@/lib/mercadolivre/hubClient";
import { mapMercadoLivreItems } from "@/lib/collect/mercadolivre";
import { persistItems, findHighlightsByProductIds } from "@/lib/collect/persist";
import { ADMIN_SESSION_COOKIE, createSessionToken } from "@/lib/adminSession";

function authHeader() {
  return { cookie: `${ADMIN_SESSION_COOKIE}=${createSessionToken()}` };
}

const session = { cookieHeader: "a=b", csrfToken: "tok" };
const mlItem = {
  itemId: "MLB1",
  title: "Creatina 1kg",
  price: 59.9,
  oldPrice: null,
  discountLabel: null,
  rating: null,
  soldLabel: null,
  image: "https://img.example/1.webp",
  permalink: "https://ml.com/MLB1",
  commissionLabel: null,
};
const highlightRow = { id: "hl1", marketplace: "MERCADO_LIVRE", productId: "MLB1" };

describe("GET /api/admin/mercadolivre/search", () => {
  beforeEach(() => {
    process.env.ADMIN_USER = "admin";
    process.env.ADMIN_PASSWORD = "test-password";
  });
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.ADMIN_USER;
    delete process.env.ADMIN_PASSWORD;
  });

  it("returns 401 without calling the session or search when unauthorized", async () => {
    const response = await GET(new NextRequest("http://localhost/api/admin/mercadolivre/search"));

    expect(response.status).toBe(401);
    expect(getSession).not.toHaveBeenCalled();
  });

  it("returns 401 session_expired when there's no saved session", async () => {
    vi.mocked(getSession).mockResolvedValue(null);

    const response = await GET(
      new NextRequest("http://localhost/api/admin/mercadolivre/search", { headers: authHeader() })
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: "session_expired" });
  });

  it("searches, persists the mapped items, and returns the enriched pool rows plus fetchedCount", async () => {
    vi.mocked(getSession).mockResolvedValue(session);
    vi.mocked(searchAffiliateProducts).mockResolvedValue([mlItem]);
    vi.mocked(mapMercadoLivreItems).mockResolvedValue([
      {
        productId: "MLB1",
        title: "Creatina 1kg",
        affiliateLink: "https://meli.la/x",
        image: "https://img.example/1.webp",
        price: 59.9,
        oldPrice: null,
        discount: null,
      },
    ]);
    vi.mocked(findHighlightsByProductIds).mockResolvedValue([highlightRow] as never);

    const response = await GET(
      new NextRequest("http://localhost/api/admin/mercadolivre/search?q=fone&offset=18", {
        headers: authHeader(),
      })
    );
    const body = await response.json();

    expect(searchAffiliateProducts).toHaveBeenCalledWith("fone", session, 18, {
      sort: "relevance",
      filters: [],
    });
    expect(mapMercadoLivreItems).toHaveBeenCalledWith([mlItem], session);
    expect(persistItems).toHaveBeenCalledWith("MERCADO_LIVRE", [
      expect.objectContaining({ productId: "MLB1" }),
    ]);
    expect(findHighlightsByProductIds).toHaveBeenCalledWith("MERCADO_LIVRE", ["MLB1"]);
    expect(body).toEqual({ items: [highlightRow], fetchedCount: 1 });
  });

  it("defaults offset to 0 and query to empty when not given", async () => {
    vi.mocked(getSession).mockResolvedValue(session);
    vi.mocked(searchAffiliateProducts).mockResolvedValue([]);
    vi.mocked(mapMercadoLivreItems).mockResolvedValue([]);
    vi.mocked(findHighlightsByProductIds).mockResolvedValue([]);

    await GET(new NextRequest("http://localhost/api/admin/mercadolivre/search", { headers: authHeader() }));

    expect(searchAffiliateProducts).toHaveBeenCalledWith("", session, 0, {
      sort: "relevance",
      filters: [],
    });
  });

  it("builds the sort and filters from query params", async () => {
    vi.mocked(getSession).mockResolvedValue(session);
    vi.mocked(searchAffiliateProducts).mockResolvedValue([]);
    vi.mocked(mapMercadoLivreItems).mockResolvedValue([]);
    vi.mocked(findHighlightsByProductIds).mockResolvedValue([]);

    await GET(
      new NextRequest(
        "http://localhost/api/admin/mercadolivre/search?sort=lowest_price&categoryId=MLB5726&categoryName=Eletrodom%C3%A9sticos&extraCommission=true",
        { headers: authHeader() }
      )
    );

    expect(searchAffiliateProducts).toHaveBeenCalledWith("", session, 0, {
      sort: "lowest_price",
      filters: [
        { id: "category", value: "MLB5726", name: "Eletrodomésticos" },
        { id: "extra_commission", value: true },
      ],
    });
  });

  it("prefers bestSeller over extraCommission when both are sent", async () => {
    vi.mocked(getSession).mockResolvedValue(session);
    vi.mocked(searchAffiliateProducts).mockResolvedValue([]);
    vi.mocked(mapMercadoLivreItems).mockResolvedValue([]);
    vi.mocked(findHighlightsByProductIds).mockResolvedValue([]);

    await GET(
      new NextRequest(
        "http://localhost/api/admin/mercadolivre/search?bestSeller=true&extraCommission=true",
        { headers: authHeader() }
      )
    );

    expect(searchAffiliateProducts).toHaveBeenCalledWith("", session, 0, {
      sort: "relevance",
      filters: [{ id: "best_seller", value: true }],
    });
  });

  it("falls back to relevance for an unrecognized sort value", async () => {
    vi.mocked(getSession).mockResolvedValue(session);
    vi.mocked(searchAffiliateProducts).mockResolvedValue([]);
    vi.mocked(mapMercadoLivreItems).mockResolvedValue([]);
    vi.mocked(findHighlightsByProductIds).mockResolvedValue([]);

    await GET(
      new NextRequest("http://localhost/api/admin/mercadolivre/search?sort=bogus", {
        headers: authHeader(),
      })
    );

    expect(searchAffiliateProducts).toHaveBeenCalledWith(
      "",
      session,
      0,
      expect.objectContaining({ sort: "relevance" })
    );
  });

  it("returns 401 session_expired when MercadoLivreSessionExpiredError is thrown", async () => {
    vi.mocked(getSession).mockResolvedValue(session);
    vi.mocked(searchAffiliateProducts).mockRejectedValue(new MercadoLivreSessionExpiredError());

    const response = await GET(
      new NextRequest("http://localhost/api/admin/mercadolivre/search", { headers: authHeader() })
    );

    expect(response.status).toBe(401);
  });

  it("returns 502 on any other error", async () => {
    vi.mocked(getSession).mockResolvedValue(session);
    vi.mocked(searchAffiliateProducts).mockRejectedValue(new Error("boom"));

    const response = await GET(
      new NextRequest("http://localhost/api/admin/mercadolivre/search", { headers: authHeader() })
    );

    expect(response.status).toBe(502);
  });
});
