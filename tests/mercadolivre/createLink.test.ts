import { describe, it, expect, vi, afterEach } from "vitest";
import {
  createAffiliateLink,
  recordGeneratedLink,
  wasGeneratedToday,
} from "@/lib/mercadolivre/createLink";
import { MercadoLivreSessionExpiredError } from "@/lib/mercadolivre/hubClient";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    mercadoLivreGeneratedLink: {
      create: vi.fn().mockResolvedValue({}),
      findFirst: vi.fn(),
    },
  },
}));

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
});

describe("recordGeneratedLink", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("creates a MercadoLivreGeneratedLink row", async () => {
    await recordGeneratedLink("MLB123", "Some Product", "https://meli.la/abc123");

    expect(prisma.mercadoLivreGeneratedLink.create).toHaveBeenCalledWith({
      data: { mlItemId: "MLB123", title: "Some Product", affiliateLink: "https://meli.la/abc123" },
    });
  });
});

describe("wasGeneratedToday", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns true when a row exists for today", async () => {
    vi.mocked(prisma.mercadoLivreGeneratedLink.findFirst).mockResolvedValue({
      id: "1",
      mlItemId: "MLB123",
      title: "x",
      affiliateLink: "y",
      generatedAt: new Date(),
    });

    expect(await wasGeneratedToday("MLB123")).toBe(true);
  });

  it("returns false when no row exists for today", async () => {
    vi.mocked(prisma.mercadoLivreGeneratedLink.findFirst).mockResolvedValue(null);

    expect(await wasGeneratedToday("MLB123")).toBe(false);
  });
});
