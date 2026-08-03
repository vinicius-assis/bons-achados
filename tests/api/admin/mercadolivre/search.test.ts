import { describe, it, expect, vi, afterEach } from "vitest";
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
  wasGeneratedToday: vi.fn().mockResolvedValue(false),
}));

import { GET } from "@/app/api/admin/mercadolivre/search/route";
import { getSession } from "@/lib/mercadolivre/session";
import { searchAffiliateProducts, MercadoLivreSessionExpiredError } from "@/lib/mercadolivre/hubClient";
import { wasGeneratedToday } from "@/lib/mercadolivre/createLink";

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

describe("GET /api/admin/mercadolivre/search", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 session_expired when no session is stored", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const request = new NextRequest("http://localhost/api/admin/mercadolivre/search?q=creatina");

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: "session_expired" });
    expect(searchAffiliateProducts).not.toHaveBeenCalled();
  });

  it("returns items annotated with generatedToday", async () => {
    vi.mocked(getSession).mockResolvedValue({ cookieHeader: "a=b", csrfToken: "t" });
    vi.mocked(searchAffiliateProducts).mockResolvedValue([item]);
    vi.mocked(wasGeneratedToday).mockResolvedValue(true);
    const request = new NextRequest("http://localhost/api/admin/mercadolivre/search?q=creatina");

    const response = await GET(request);
    const body = await response.json();

    expect(searchAffiliateProducts).toHaveBeenCalledWith("creatina", { cookieHeader: "a=b", csrfToken: "t" });
    expect(body).toEqual({ items: [{ ...item, generatedToday: true }] });
  });

  it("returns 401 session_expired when the client throws MercadoLivreSessionExpiredError", async () => {
    vi.mocked(getSession).mockResolvedValue({ cookieHeader: "a=b", csrfToken: "t" });
    vi.mocked(searchAffiliateProducts).mockRejectedValue(new MercadoLivreSessionExpiredError());
    const request = new NextRequest("http://localhost/api/admin/mercadolivre/search?q=creatina");

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: "session_expired" });
  });

  it("returns 502 on any other error", async () => {
    vi.mocked(getSession).mockResolvedValue({ cookieHeader: "a=b", csrfToken: "t" });
    vi.mocked(searchAffiliateProducts).mockRejectedValue(new Error("boom"));
    const request = new NextRequest("http://localhost/api/admin/mercadolivre/search?q=creatina");

    const response = await GET(request);

    expect(response.status).toBe(502);
  });
});
