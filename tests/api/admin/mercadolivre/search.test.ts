import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/mercadolivre/session", () => ({
  getSession: vi.fn(),
}));
vi.mock("@/lib/mercadolivre/hubClient", async () => {
  const actual = await vi.importActual("@/lib/mercadolivre/hubClient");
  return {
    ...actual,
    searchAffiliateProducts: vi.fn(),
  };
});
vi.mock("@/lib/mercadolivre/createLink", () => ({
  findGeneratedTodayMap: vi.fn().mockResolvedValue(new Map()),
}));

import { GET } from "@/app/api/admin/mercadolivre/search/route";
import { getSession } from "@/lib/mercadolivre/session";
import { searchAffiliateProducts, MercadoLivreSessionExpiredError } from "@/lib/mercadolivre/hubClient";
import { findGeneratedTodayMap } from "@/lib/mercadolivre/createLink";
import { ADMIN_SESSION_COOKIE, createSessionToken } from "@/lib/adminSession";

function authHeader() {
  return { cookie: `${ADMIN_SESSION_COOKIE}=${createSessionToken()}` };
}

const item = {
  itemId: "MLB123",
  title: "Produto",
  price: 10,
  oldPrice: null,
  discountLabel: null,
  rating: null,
  soldLabel: null,
  image: "",
  permalink: "https://www.mercadolivre.com.br/p/MLB123",
  commissionLabel: null,
};

function buildRequest(query = "creatina", offset?: number) {
  const url = new URL("http://localhost/api/admin/mercadolivre/search");
  url.searchParams.set("q", query);
  if (offset !== undefined) {
    url.searchParams.set("offset", String(offset));
  }
  return new NextRequest(url, { headers: authHeader() });
}

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

  it("returns 401 without calling any library functions when the session cookie is missing or invalid", async () => {
    const request = new NextRequest("http://localhost/api/admin/mercadolivre/search?q=creatina");

    const response = await GET(request);

    expect(response.status).toBe(401);
    expect(getSession).not.toHaveBeenCalled();
    expect(searchAffiliateProducts).not.toHaveBeenCalled();
    expect(findGeneratedTodayMap).not.toHaveBeenCalled();
  });

  it("returns 401 session_expired when no session is stored", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const request = buildRequest();

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: "session_expired" });
    expect(searchAffiliateProducts).not.toHaveBeenCalled();
  });

  it("returns items annotated with generatedLink from the batched map", async () => {
    vi.mocked(getSession).mockResolvedValue({ cookieHeader: "a=b", csrfToken: "t" });
    vi.mocked(searchAffiliateProducts).mockResolvedValue([item]);
    vi.mocked(findGeneratedTodayMap).mockResolvedValue(new Map([["MLB123", "https://meli.la/abc"]]));
    const request = buildRequest();

    const response = await GET(request);
    const body = await response.json();

    expect(searchAffiliateProducts).toHaveBeenCalledWith("creatina", { cookieHeader: "a=b", csrfToken: "t" }, 0);
    expect(findGeneratedTodayMap).toHaveBeenCalledWith(["MLB123"]);
    expect(body).toEqual({ items: [{ ...item, generatedLink: "https://meli.la/abc" }] });
  });

  it("passes the offset query param through to searchAffiliateProducts for pagination", async () => {
    vi.mocked(getSession).mockResolvedValue({ cookieHeader: "a=b", csrfToken: "t" });
    vi.mocked(searchAffiliateProducts).mockResolvedValue([item]);
    const request = buildRequest("creatina", 30);

    await GET(request);

    expect(searchAffiliateProducts).toHaveBeenCalledWith(
      "creatina",
      { cookieHeader: "a=b", csrfToken: "t" },
      30
    );
  });

  it("defaults to offset 0 when the offset param is missing, negative, or invalid", async () => {
    vi.mocked(getSession).mockResolvedValue({ cookieHeader: "a=b", csrfToken: "t" });
    vi.mocked(searchAffiliateProducts).mockResolvedValue([item]);

    await GET(buildRequest("creatina", -5));

    expect(searchAffiliateProducts).toHaveBeenCalledWith(
      "creatina",
      { cookieHeader: "a=b", csrfToken: "t" },
      0
    );
  });

  it("returns generatedLink: null when the item was not generated today", async () => {
    vi.mocked(getSession).mockResolvedValue({ cookieHeader: "a=b", csrfToken: "t" });
    vi.mocked(searchAffiliateProducts).mockResolvedValue([item]);
    vi.mocked(findGeneratedTodayMap).mockResolvedValue(new Map());
    const request = buildRequest();

    const response = await GET(request);
    const body = await response.json();

    expect(body).toEqual({ items: [{ ...item, generatedLink: null }] });
  });

  it("returns 401 session_expired when the client throws MercadoLivreSessionExpiredError", async () => {
    vi.mocked(getSession).mockResolvedValue({ cookieHeader: "a=b", csrfToken: "t" });
    vi.mocked(searchAffiliateProducts).mockRejectedValue(new MercadoLivreSessionExpiredError());
    const request = buildRequest();

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: "session_expired" });
  });

  it("returns 502 on any other error", async () => {
    vi.mocked(getSession).mockResolvedValue({ cookieHeader: "a=b", csrfToken: "t" });
    vi.mocked(searchAffiliateProducts).mockRejectedValue(new Error("boom"));
    const request = buildRequest();

    const response = await GET(request);

    expect(response.status).toBe(502);
  });
});
