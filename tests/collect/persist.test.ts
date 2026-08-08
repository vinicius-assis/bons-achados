import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    highlight: {
      createMany: vi.fn(),
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
    vi.mocked(prisma.highlight.createMany).mockResolvedValue({ count: 1 } as never);

    const result = await persistItems("MERCADO_LIVRE", [ITEM, { ...ITEM, productId: "MLB2", image: "" }]);

    expect(prisma.highlight.createMany).toHaveBeenCalledWith({
      data: [
        {
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
      ],
      skipDuplicates: true,
    });
    expect(result).toEqual({ inserted: 1, skipped: 1 });
  });

  it("drops items with a non-positive price before writing", async () => {
    vi.mocked(prisma.highlight.createMany).mockResolvedValue({ count: 0 } as never);

    const result = await persistItems("AMAZON", [{ ...ITEM, price: 0 }]);

    expect(prisma.highlight.createMany).not.toHaveBeenCalled();
    expect(result).toEqual({ inserted: 0, skipped: 1 });
  });

  it("counts duplicates skipped by the database as skipped", async () => {
    vi.mocked(prisma.highlight.createMany).mockResolvedValue({ count: 1 } as never);

    const result = await persistItems("SHOPEE", [ITEM, { ...ITEM, productId: "MLB2" }]);

    expect(result).toEqual({ inserted: 1, skipped: 1 });
  });

  it("returns zero/zero for an empty item list without calling the database", async () => {
    const result = await persistItems("AMAZON", []);

    expect(prisma.highlight.createMany).not.toHaveBeenCalled();
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
