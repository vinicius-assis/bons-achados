import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    highlight: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/prisma";
import {
  createHighlight,
  findHighlightByProductId,
  listTodaysHighlights,
  listHighlightsPage,
  removeHighlight,
  deleteStaleHighlights,
} from "@/lib/highlights/store";

const BASE_INPUT = {
  marketplace: "MERCADO_LIVRE" as const,
  productId: "MLB123",
  title: "Creatina 1kg Suplemento",
  note: "Testei e recomendo, ótimo custo-benefício.",
  affiliateLink: "https://meli.la/abc",
  image: "https://img.example/1.webp",
  price: 59.9,
  oldPrice: 89.9,
  discount: 33,
};

describe("createHighlight", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("creates a row with the given data, including productId", async () => {
    vi.mocked(prisma.highlight.create).mockResolvedValue({ id: "hl1", ...BASE_INPUT } as never);

    const result = await createHighlight(BASE_INPUT);

    expect(prisma.highlight.create).toHaveBeenCalledWith({ data: BASE_INPUT });
    expect(result).toEqual({ id: "hl1", ...BASE_INPUT });
  });
});

describe("findHighlightByProductId", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("looks up by the compound marketplace+productId key", async () => {
    vi.mocked(prisma.highlight.findUnique).mockResolvedValue({ id: "hl1" } as never);

    const result = await findHighlightByProductId("AMAZON", "B08N5WRWNW");

    expect(prisma.highlight.findUnique).toHaveBeenCalledWith({
      where: { marketplace_productId: { marketplace: "AMAZON", productId: "B08N5WRWNW" } },
    });
    expect(result).toEqual({ id: "hl1" });
  });

  it("returns null when no row matches", async () => {
    vi.mocked(prisma.highlight.findUnique).mockResolvedValue(null);

    const result = await findHighlightByProductId("AMAZON", "NOPE");

    expect(result).toBeNull();
  });
});

describe("listTodaysHighlights", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-03T15:00:00.000Z")); // 12:00 in America/Sao_Paulo
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("lists all of today's rows (since the 5am cutoff), newest first, when no marketplace is given", async () => {
    vi.mocked(prisma.highlight.findMany).mockResolvedValue([] as never);

    await listTodaysHighlights();

    expect(prisma.highlight.findMany).toHaveBeenCalledWith({
      where: { createdAt: { gte: new Date("2026-08-03T08:00:00.000Z") } }, // 05:00 BRT = 08:00 UTC
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
  });

  it("adds a marketplace filter when given", async () => {
    vi.mocked(prisma.highlight.findMany).mockResolvedValue([] as never);

    await listTodaysHighlights("AMAZON");

    expect(prisma.highlight.findMany).toHaveBeenCalledWith({
      where: {
        createdAt: { gte: new Date("2026-08-03T08:00:00.000Z") },
        marketplace: "AMAZON",
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
  });
});

describe("listHighlightsPage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-03T15:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("queries page 1 with the given page size, marketplaces and cutoff", async () => {
    vi.mocked(prisma.highlight.findMany).mockResolvedValue(
      Array.from({ length: 5 }, (_, i) => ({ id: `hl${i}` })) as never
    );

    const result = await listHighlightsPage({
      page: 1,
      pageSize: 30,
      marketplaces: ["MERCADO_LIVRE", "AMAZON", "SHOPEE"],
      q: "",
    });

    expect(prisma.highlight.findMany).toHaveBeenCalledWith({
      where: {
        createdAt: { gte: new Date("2026-08-03T08:00:00.000Z") },
        marketplace: { in: ["MERCADO_LIVRE", "AMAZON", "SHOPEE"] },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: 0,
      take: 31,
    });
    expect(result).toEqual({ items: expect.any(Array), hasNextPage: false });
    expect(result.items).toHaveLength(5);
  });

  it("adds a case-insensitive title filter when q is given", async () => {
    vi.mocked(prisma.highlight.findMany).mockResolvedValue([] as never);

    await listHighlightsPage({ page: 1, pageSize: 30, marketplaces: ["AMAZON"], q: "fone" });

    expect(prisma.highlight.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          createdAt: { gte: new Date("2026-08-03T08:00:00.000Z") },
          marketplace: { in: ["AMAZON"] },
          title: { contains: "fone", mode: "insensitive" },
        },
      })
    );
  });

  it("skips to the right offset for page 2", async () => {
    vi.mocked(prisma.highlight.findMany).mockResolvedValue([] as never);

    await listHighlightsPage({ page: 2, pageSize: 30, marketplaces: ["AMAZON"], q: "" });

    expect(prisma.highlight.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 30, take: 31 })
    );
  });

  it("reports hasNextPage true when one extra row beyond pageSize comes back", async () => {
    vi.mocked(prisma.highlight.findMany).mockResolvedValue(
      Array.from({ length: 31 }, (_, i) => ({ id: `hl${i}` })) as never
    );

    const result = await listHighlightsPage({
      page: 1,
      pageSize: 30,
      marketplaces: ["AMAZON"],
      q: "",
    });

    expect(result.hasNextPage).toBe(true);
    expect(result.items).toHaveLength(30);
  });

  it("returns an empty page with no marketplaces selected, without erroring", async () => {
    vi.mocked(prisma.highlight.findMany).mockResolvedValue([] as never);

    const result = await listHighlightsPage({ page: 1, pageSize: 30, marketplaces: [], q: "" });

    expect(prisma.highlight.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ marketplace: { in: [] } }) })
    );
    expect(result).toEqual({ items: [], hasNextPage: false });
  });
});

describe("removeHighlight", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("deletes the row by id", async () => {
    vi.mocked(prisma.highlight.deleteMany).mockResolvedValue({ count: 1 } as never);

    await removeHighlight("hl1");

    expect(prisma.highlight.deleteMany).toHaveBeenCalledWith({ where: { id: "hl1" } });
  });

  it("does not throw when the id does not exist", async () => {
    vi.mocked(prisma.highlight.deleteMany).mockResolvedValue({ count: 0 } as never);

    await expect(removeHighlight("missing")).resolves.toBeUndefined();
  });
});

describe("deleteStaleHighlights", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-03T15:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("deletes rows created before today's 5am cutoff in America/Sao_Paulo", async () => {
    vi.mocked(prisma.highlight.deleteMany).mockResolvedValue({ count: 7 } as never);

    const count = await deleteStaleHighlights();

    expect(prisma.highlight.deleteMany).toHaveBeenCalledWith({
      where: { createdAt: { lt: new Date("2026-08-03T08:00:00.000Z") } },
    });
    expect(count).toBe(7);
  });
});
