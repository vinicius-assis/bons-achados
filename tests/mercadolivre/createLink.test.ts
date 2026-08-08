import { describe, it, expect, vi, afterEach } from "vitest";
import { createAffiliateLink } from "@/lib/mercadolivre/createLink";
import { MercadoLivreSessionExpiredError } from "@/lib/mercadolivre/hubClient";

const session = { cookieHeader: "a=b; c=d", csrfToken: "token123" };

describe("createAffiliateLink", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("sends the url and tag, and returns the short and long urls", async () => {
    process.env.ML_AFFILIATE_WORD = "bonsachados";
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        urls: [{ short_url: "https://meli.la/abc123", long_url: "https://www.mercadolivre.com.br/social/..." }],
      }),
    } as Response);

    const result = await createAffiliateLink("https://www.mercadolivre.com.br/produto/p/MLB1", session);

    expect(global.fetch).toHaveBeenCalledWith(
      "https://www.mercadolivre.com.br/affiliate-program/api/v2/affiliates/createLink",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          cookie: "a=b; c=d",
          "x-csrf-token": "token123",
        }),
        body: JSON.stringify({
          urls: ["https://www.mercadolivre.com.br/produto/p/MLB1"],
          tag: "bonsachados",
        }),
      })
    );
    expect(result).toEqual({
      shortUrl: "https://meli.la/abc123",
      longUrl: "https://www.mercadolivre.com.br/social/...",
    });

    delete process.env.ML_AFFILIATE_WORD;
  });

  it("throws MercadoLivreSessionExpiredError on a 403 response", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 403 } as Response);

    await expect(
      createAffiliateLink("https://www.mercadolivre.com.br/produto/p/MLB1", session)
    ).rejects.toThrow(MercadoLivreSessionExpiredError);
  });

  it("throws when the response is missing short_url/long_url", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ urls: [{}] }),
    } as Response);

    await expect(
      createAffiliateLink("https://www.mercadolivre.com.br/produto/p/MLB1", session)
    ).rejects.toThrow("Mercado Livre createLink response missing short_url/long_url");
  });

  it("throws a generic error on other non-ok statuses", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 } as Response);

    await expect(
      createAffiliateLink("https://www.mercadolivre.com.br/produto/p/MLB1", session)
    ).rejects.toThrow("Mercado Livre createLink failed: 500");
  });

  it("passes an abort signal with a timeout to fetch", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        urls: [{ short_url: "https://meli.la/abc123", long_url: "https://www.mercadolivre.com.br/social/..." }],
      }),
    } as Response);

    await createAffiliateLink("https://www.mercadolivre.com.br/produto/p/MLB1", session);

    expect(global.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });
});
