import { describe, it, expect, vi, afterEach } from "vitest";
import {
  createAffiliateLink,
  recordGeneratedLink,
  wasGeneratedToday,
  findGeneratedTodayMap,
} from "@/lib/mercadolivre/createLink";
import { MercadoLivreSessionExpiredError } from "@/lib/mercadolivre/hubClient";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    mercadoLivreGeneratedLink: {
      create: vi.fn().mockResolvedValue({}),
      findFirst: vi.fn(),
      findMany: vi.fn(),
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

describe("findGeneratedTodayMap", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("issues a single batched query and maps mlItemId to affiliateLink", async () => {
    vi.mocked(prisma.mercadoLivreGeneratedLink.findMany).mockResolvedValue([
      { id: "1", mlItemId: "MLB1", title: "a", affiliateLink: "https://meli.la/1", generatedAt: new Date() },
      { id: "2", mlItemId: "MLB2", title: "b", affiliateLink: "https://meli.la/2", generatedAt: new Date() },
    ]);

    const map = await findGeneratedTodayMap(["MLB1", "MLB2", "MLB3"]);

    expect(prisma.mercadoLivreGeneratedLink.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.mercadoLivreGeneratedLink.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ mlItemId: { in: ["MLB1", "MLB2", "MLB3"] } }),
      })
    );
    expect(map.get("MLB1")).toBe("https://meli.la/1");
    expect(map.get("MLB2")).toBe("https://meli.la/2");
    expect(map.has("MLB3")).toBe(false);
  });

  it("keeps only the most recent link when an item has multiple rows today", async () => {
    vi.mocked(prisma.mercadoLivreGeneratedLink.findMany).mockResolvedValue([
      { id: "2", mlItemId: "MLB1", title: "a", affiliateLink: "https://meli.la/newest", generatedAt: new Date() },
      { id: "1", mlItemId: "MLB1", title: "a", affiliateLink: "https://meli.la/oldest", generatedAt: new Date() },
    ]);

    const map = await findGeneratedTodayMap(["MLB1"]);

    expect(map.get("MLB1")).toBe("https://meli.la/newest");
  });
});
