import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/mercadolivre/session", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/mercadolivre/hubClient", async () => {
  const actual = await vi.importActual("@/lib/mercadolivre/hubClient");
  return { ...actual, searchAffiliateProducts: vi.fn() };
});
vi.mock("@/lib/mercadolivre/createLink", () => ({ createAffiliateLink: vi.fn() }));
vi.mock("@/lib/collect/persist", () => ({ persistItems: vi.fn() }));
vi.mock("@/lib/collect/searchTerms", () => ({ pickRandomSearchTerm: vi.fn().mockReturnValue("eletrônicos") }));
vi.mock("@/lib/prisma", () => ({ prisma: { highlight: { findMany: vi.fn() } } }));

import { getSession } from "@/lib/mercadolivre/session";
import {
  searchAffiliateProducts,
  MercadoLivreSessionExpiredError,
  type MLHubItem,
} from "@/lib/mercadolivre/hubClient";
import { createAffiliateLink } from "@/lib/mercadolivre/createLink";
import { persistItems } from "@/lib/collect/persist";
import { prisma } from "@/lib/prisma";
import { mapMercadoLivreItems, collectMercadoLivre } from "@/lib/collect/mercadolivre";

const session = { cookieHeader: "a=b", csrfToken: "tok" };

function buildItem(overrides: Partial<MLHubItem> = {}): MLHubItem {
  return {
    itemId: "MLB1",
    title: "Creatina 1kg",
    price: 59.9,
    oldPrice: 89.9,
    discountLabel: "33% OFF",
    rating: 4.8,
    soldLabel: "+500 vendidos",
    image: "https://img.example/1.webp",
    permalink: "https://www.mercadolivre.com.br/p/MLB1",
    commissionLabel: "25%",
    ...overrides,
  };
}

describe("mapMercadoLivreItems", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns an empty array without querying the database for an empty input", async () => {
    const result = await mapMercadoLivreItems([], session);

    expect(prisma.highlight.findMany).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it("calls createAffiliateLink only for items not already pooled today", async () => {
    vi.mocked(prisma.highlight.findMany).mockResolvedValue([{ productId: "MLB1" }] as never);
    vi.mocked(createAffiliateLink).mockResolvedValue({
      shortUrl: "https://meli.la/xyz",
      longUrl: "https://www.mercadolivre.com.br/social/...",
    });

    const items = [buildItem({ itemId: "MLB1" }), buildItem({ itemId: "MLB2", permalink: "https://ml.com/MLB2" })];
    const result = await mapMercadoLivreItems(items, session);

    expect(prisma.highlight.findMany).toHaveBeenCalledWith({
      where: { marketplace: "MERCADO_LIVRE", productId: { in: ["MLB1", "MLB2"] } },
      select: { productId: true },
    });
    expect(createAffiliateLink).toHaveBeenCalledTimes(1);
    expect(createAffiliateLink).toHaveBeenCalledWith("https://ml.com/MLB2", session);
    expect(result).toEqual([
      {
        productId: "MLB2",
        title: "Creatina 1kg",
        affiliateLink: "https://meli.la/xyz",
        image: "https://img.example/1.webp",
        price: 59.9,
        oldPrice: 89.9,
        discount: 33,
      },
    ]);
  });

  it("propagates MercadoLivreSessionExpiredError from createAffiliateLink", async () => {
    vi.mocked(prisma.highlight.findMany).mockResolvedValue([] as never);
    vi.mocked(createAffiliateLink).mockRejectedValue(new MercadoLivreSessionExpiredError());

    await expect(mapMercadoLivreItems([buildItem()], session)).rejects.toThrow(
      MercadoLivreSessionExpiredError
    );
  });
});

describe("collectMercadoLivre", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns a no_session error without fetching when there's no saved session", async () => {
    vi.mocked(getSession).mockResolvedValue(null);

    const result = await collectMercadoLivre();

    expect(searchAffiliateProducts).not.toHaveBeenCalled();
    expect(result).toEqual({ attempted: 0, inserted: 0, skipped: 0, error: "no_session" });
  });

  it("uses the given term instead of sampling one when a term is provided", async () => {
    vi.mocked(getSession).mockResolvedValue(session);
    vi.mocked(searchAffiliateProducts).mockResolvedValue([]);

    await collectMercadoLivre("air fryer");

    expect(searchAffiliateProducts).toHaveBeenCalledWith("air fryer", session, 0);
  });

  it("samples a random term when none is given", async () => {
    vi.mocked(getSession).mockResolvedValue(session);
    vi.mocked(searchAffiliateProducts).mockResolvedValue([]);

    await collectMercadoLivre();

    expect(searchAffiliateProducts).toHaveBeenCalledWith("eletrônicos", session, 0);
  });

  it("pages until it has 50 items, then stops requesting more", async () => {
    vi.mocked(getSession).mockResolvedValue(session);
    vi.mocked(prisma.highlight.findMany).mockResolvedValue([] as never);
    vi.mocked(createAffiliateLink).mockResolvedValue({ shortUrl: "https://meli.la/x", longUrl: "https://ml.com" });
    vi.mocked(searchAffiliateProducts)
      .mockResolvedValueOnce(Array.from({ length: 30 }, (_, i) => buildItem({ itemId: `MLB${i}` })))
      .mockResolvedValueOnce(Array.from({ length: 30 }, (_, i) => buildItem({ itemId: `MLB${30 + i}` })));
    vi.mocked(persistItems).mockResolvedValue({ inserted: 50, skipped: 0 });

    const result = await collectMercadoLivre("eletrônicos");

    expect(searchAffiliateProducts).toHaveBeenCalledTimes(2);
    expect(searchAffiliateProducts).toHaveBeenNthCalledWith(1, "eletrônicos", session, 0);
    expect(searchAffiliateProducts).toHaveBeenNthCalledWith(2, "eletrônicos", session, 30);
    expect(result.attempted).toBe(50);
  });

  it("stops paging when a page comes back empty", async () => {
    vi.mocked(getSession).mockResolvedValue(session);
    vi.mocked(searchAffiliateProducts).mockResolvedValue([]);

    const result = await collectMercadoLivre("eletrônicos");

    expect(searchAffiliateProducts).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ attempted: 0, inserted: 0, skipped: 0 });
  });

  it("persists the mapped items and returns the counts from persistItems", async () => {
    vi.mocked(getSession).mockResolvedValue(session);
    vi.mocked(prisma.highlight.findMany).mockResolvedValue([] as never);
    vi.mocked(searchAffiliateProducts).mockResolvedValueOnce([buildItem()]).mockResolvedValueOnce([]);
    vi.mocked(createAffiliateLink).mockResolvedValue({ shortUrl: "https://meli.la/x", longUrl: "https://ml.com" });
    vi.mocked(persistItems).mockResolvedValue({ inserted: 1, skipped: 0 });

    const result = await collectMercadoLivre("eletrônicos");

    expect(persistItems).toHaveBeenCalledWith("MERCADO_LIVRE", [
      expect.objectContaining({ productId: "MLB1", affiliateLink: "https://meli.la/x" }),
    ]);
    expect(result).toEqual({ attempted: 1, inserted: 1, skipped: 0 });
  });

  it("returns a session_expired error without throwing when the session expires mid-run", async () => {
    vi.mocked(getSession).mockResolvedValue(session);
    vi.mocked(searchAffiliateProducts).mockResolvedValueOnce([buildItem()]);
    vi.mocked(prisma.highlight.findMany).mockResolvedValue([] as never);
    vi.mocked(createAffiliateLink).mockRejectedValue(new MercadoLivreSessionExpiredError());

    const result = await collectMercadoLivre("eletrônicos");

    expect(result).toEqual({ attempted: 0, inserted: 0, skipped: 0, error: "session_expired" });
  });

  it("returns a collect_failed error without throwing on any other error", async () => {
    vi.mocked(getSession).mockResolvedValue(session);
    vi.mocked(searchAffiliateProducts).mockRejectedValue(new Error("boom"));

    const result = await collectMercadoLivre("eletrônicos");

    expect(result).toEqual({ attempted: 0, inserted: 0, skipped: 0, error: "collect_failed" });
  });
});
