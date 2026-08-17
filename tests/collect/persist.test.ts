import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    highlight: {
      upsert: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));
vi.mock("@/lib/highlights/noteTemplates", () => ({
  pickRandomNote: vi.fn().mockReturnValue("Ótimo custo-benefício para quem busca praticidade."),
}));

import { prisma } from "@/lib/prisma";
import { persistItems, findHighlightsByProductIds } from "@/lib/collect/persist";
import type { CollectItem } from "@/lib/collect/types";

const ITEM: CollectItem = {
  productId: "MLB1",
  title: "Creatina 1kg",
  affiliateLink: "https://meli.la/abc",
  image: "https://img.example/1.webp",
  price: 59.9,
  oldPrice: 89.9,
  discount: 33,
};

describe("persistItems", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("drops items with no image before writing", async () => {
    vi.mocked(prisma.highlight.upsert).mockResolvedValue({} as never);

    const result = await persistItems("MERCADO_LIVRE", [ITEM, { ...ITEM, productId: "MLB2", image: "" }]);

    expect(prisma.highlight.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.highlight.upsert).toHaveBeenCalledWith({
      where: { marketplace_productId: { marketplace: "MERCADO_LIVRE", productId: "MLB1" } },
      create: {
        marketplace: "MERCADO_LIVRE",
        productId: "MLB1",
        title: "Creatina 1kg",
        affiliateLink: "https://meli.la/abc",
        image: "https://img.example/1.webp",
        price: 59.9,
        oldPrice: 89.9,
        discount: 33,
        note: "Ótimo custo-benefício para quem busca praticidade.",
      },
      update: {
        price: 59.9,
        oldPrice: 89.9,
        discount: 33,
      },
    });
    expect(result).toEqual({ inserted: 1, skipped: 1 });
  });

  it("drops items with a non-positive price before writing", async () => {
    const result = await persistItems("AMAZON", [{ ...ITEM, price: 0 }]);

    expect(prisma.highlight.upsert).not.toHaveBeenCalled();
    expect(result).toEqual({ inserted: 0, skipped: 1 });
  });

  it("upserts every valid item, even repeated productIds across the same batch", async () => {
    vi.mocked(prisma.highlight.upsert).mockResolvedValue({} as never);

    const result = await persistItems("SHOPEE", [ITEM, { ...ITEM, price: 49.9 }]);

    expect(prisma.highlight.upsert).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ inserted: 2, skipped: 0 });
  });

  it("returns zero/zero for an empty item list without calling the database", async () => {
    const result = await persistItems("AMAZON", []);

    expect(prisma.highlight.upsert).not.toHaveBeenCalled();
    expect(result).toEqual({ inserted: 0, skipped: 0 });
  });
});

describe("findHighlightsByProductIds", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("queries by marketplace and productId list", async () => {
    vi.mocked(prisma.highlight.findMany).mockResolvedValue([{ id: "hl1" }] as never);

    const result = await findHighlightsByProductIds("AMAZON", ["B01", "B02"]);

    expect(prisma.highlight.findMany).toHaveBeenCalledWith({
      where: { marketplace: "AMAZON", productId: { in: ["B01", "B02"] } },
    });
    expect(result).toEqual([{ id: "hl1" }]);
  });

  it("returns an empty array without querying when productIds is empty", async () => {
    const result = await findHighlightsByProductIds("AMAZON", []);

    expect(prisma.highlight.findMany).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });
});
