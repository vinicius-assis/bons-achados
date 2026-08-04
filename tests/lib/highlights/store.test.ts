import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    highlight: {
      create: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/prisma";
import {
  createHighlight,
  listTodaysHighlights,
  removeHighlight,
  deleteStaleHighlights,
} from "@/lib/highlights/store";

const BASE_INPUT = {
  marketplace: "MERCADO_LIVRE" as const,
  title: "Creatina 1kg Suplemento",
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

  it("creates a row with the given data", async () => {
    vi.mocked(prisma.highlight.create).mockResolvedValue({ id: "hl1", ...BASE_INPUT } as never);

    const result = await createHighlight(BASE_INPUT);

    expect(prisma.highlight.create).toHaveBeenCalledWith({ data: BASE_INPUT });
    expect(result).toEqual({ id: "hl1", ...BASE_INPUT });
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

  it("lists rows created today, newest first", async () => {
    vi.mocked(prisma.highlight.findMany).mockResolvedValue([] as never);

    await listTodaysHighlights();

    expect(prisma.highlight.findMany).toHaveBeenCalledWith({
      where: { createdAt: { gte: new Date("2026-08-03T03:00:00.000Z") } }, // 00:00 BRT = 03:00 UTC
      orderBy: { createdAt: "desc" },
    });
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

  it("deletes rows created before the start of today in America/Sao_Paulo", async () => {
    vi.mocked(prisma.highlight.deleteMany).mockResolvedValue({ count: 7 } as never);

    const count = await deleteStaleHighlights();

    expect(prisma.highlight.deleteMany).toHaveBeenCalledWith({
      where: { createdAt: { lt: new Date("2026-08-03T03:00:00.000Z") } },
    });
    expect(count).toBe(7);
  });
});
