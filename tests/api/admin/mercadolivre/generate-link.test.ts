import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/mercadolivre/session", () => ({
  getSession: vi.fn(),
}));
vi.mock("@/lib/mercadolivre/createLink", () => ({
  createAffiliateLink: vi.fn(),
  recordGeneratedLink: vi.fn().mockResolvedValue(undefined),
}));

import { POST } from "@/app/api/admin/mercadolivre/generate-link/route";
import { getSession } from "@/lib/mercadolivre/session";
import { createAffiliateLink, recordGeneratedLink } from "@/lib/mercadolivre/createLink";
import { MercadoLivreSessionExpiredError } from "@/lib/mercadolivre/hubClient";

const AUTH_HEADER = { authorization: `Basic ${Buffer.from("admin:test-password").toString("base64")}` };

function buildRequest(body: unknown, headers: Record<string, string> = AUTH_HEADER) {
  return new NextRequest("http://localhost/api/admin/mercadolivre/generate-link", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

describe("POST /api/admin/mercadolivre/generate-link", () => {
  beforeEach(() => {
    process.env.ADMIN_USER = "admin";
    process.env.ADMIN_PASSWORD = "test-password";
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.ADMIN_USER;
    delete process.env.ADMIN_PASSWORD;
  });

  it("returns 401 without calling getSession when Basic Auth is missing or invalid", async () => {
    const response = await POST(
      buildRequest({ itemId: "MLB1", url: "https://x", title: "Produto" }, {})
    );

    expect(response.status).toBe(401);
    expect(getSession).not.toHaveBeenCalled();
  });

  it("returns 400 when itemId, url, or title is missing", async () => {
    const response = await POST(buildRequest({ itemId: "MLB1" }));

    expect(response.status).toBe(400);
    expect(getSession).not.toHaveBeenCalled();
  });

  it("returns 401 session_expired when no session is stored", async () => {
    vi.mocked(getSession).mockResolvedValue(null);

    const response = await POST(buildRequest({ itemId: "MLB1", url: "https://x", title: "Produto" }));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: "session_expired" });
  });

  it("creates the link, records it, and returns the affiliate link", async () => {
    vi.mocked(getSession).mockResolvedValue({ cookieHeader: "a=b", csrfToken: "t" });
    vi.mocked(createAffiliateLink).mockResolvedValue({
      shortUrl: "https://meli.la/abc",
      longUrl: "https://www.mercadolivre.com.br/social/...",
    });

    const response = await POST(buildRequest({ itemId: "MLB1", url: "https://x", title: "Produto" }));
    const body = await response.json();

    expect(createAffiliateLink).toHaveBeenCalledWith("https://x", { cookieHeader: "a=b", csrfToken: "t" });
    expect(recordGeneratedLink).toHaveBeenCalledWith("MLB1", "Produto", "https://meli.la/abc");
    expect(body).toEqual({ affiliateLink: "https://meli.la/abc" });
  });

  it("returns 401 session_expired when createAffiliateLink throws MercadoLivreSessionExpiredError", async () => {
    vi.mocked(getSession).mockResolvedValue({ cookieHeader: "a=b", csrfToken: "t" });
    vi.mocked(createAffiliateLink).mockRejectedValue(new MercadoLivreSessionExpiredError());

    const response = await POST(buildRequest({ itemId: "MLB1", url: "https://x", title: "Produto" }));

    expect(response.status).toBe(401);
    expect(recordGeneratedLink).not.toHaveBeenCalled();
  });

  it("returns 502 on any other error", async () => {
    vi.mocked(getSession).mockResolvedValue({ cookieHeader: "a=b", csrfToken: "t" });
    vi.mocked(createAffiliateLink).mockRejectedValue(new Error("boom"));

    const response = await POST(buildRequest({ itemId: "MLB1", url: "https://x", title: "Produto" }));

    expect(response.status).toBe(502);
  });
});
