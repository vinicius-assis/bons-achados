import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    postDraft: {
      findFirst: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/prisma";
import {
  createPostDraft,
  listActivePostDrafts,
  clearActivePostDrafts,
  deleteStalePostDrafts,
  getPostDraftById,
} from "@/lib/postdraft/store";

const BASE_INPUT = {
  marketplace: "MERCADO_LIVRE" as const,
  source: "AUTO" as const,
  title: "Creatina 1kg Suplemento",
  affiliateLink: "https://meli.la/abc",
  image: "https://img.example/1.webp",
  price: 59.9,
  discount: 25,
  category: null,
};

describe("createPostDraft", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-03T15:00:00.000Z")); // 12:00 in America/Sao_Paulo
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("creates a row and auto-categorizes when category is not supplied", async () => {
    vi.mocked(prisma.postDraft.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.postDraft.create).mockResolvedValue({ id: "cd1" } as never);

    const result = await createPostDraft(BASE_INPUT);

    expect(result).toEqual({ status: "created", id: "cd1", category: "suplemento" });
    expect(prisma.postDraft.create).toHaveBeenCalledWith({
      data: { ...BASE_INPUT, category: "suplemento" },
    });
  });

  it("keeps an explicitly supplied category", async () => {
    vi.mocked(prisma.postDraft.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.postDraft.create).mockResolvedValue({ id: "cd2" } as never);

    const result = await createPostDraft({ ...BASE_INPUT, category: "outro" });

    expect(result).toEqual({ status: "created", id: "cd2", category: "outro" });
  });

  it("returns duplicate when the same affiliateLink was created today, without creating a row", async () => {
    const createdAt = new Date("2026-08-03T13:00:00.000Z");
    vi.mocked(prisma.postDraft.findFirst).mockResolvedValue({ createdAt } as never);

    const result = await createPostDraft(BASE_INPUT);

    expect(result).toEqual({ status: "duplicate", createdAt });
    expect(prisma.postDraft.create).not.toHaveBeenCalled();
  });

  it("scopes the duplicate lookup to the start of today in America/Sao_Paulo", async () => {
    vi.mocked(prisma.postDraft.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.postDraft.create).mockResolvedValue({ id: "cd3" } as never);

    await createPostDraft(BASE_INPUT);

    expect(prisma.postDraft.findFirst).toHaveBeenCalledWith({
      where: {
        affiliateLink: BASE_INPUT.affiliateLink,
        createdAt: { gte: new Date("2026-08-03T08:00:00.000Z") }, // 05:00 BRT = 08:00 UTC
      },
      orderBy: { createdAt: "desc" },
    });
  });
});

describe("listActivePostDrafts", () => {
  it("lists postDraft rows with postedAt null, newest first", async () => {
    vi.mocked(prisma.postDraft.findMany).mockResolvedValue([] as never);

    await listActivePostDrafts();

    expect(prisma.postDraft.findMany).toHaveBeenCalledWith({
      where: { postedAt: null },
      orderBy: { createdAt: "desc" },
    });
  });
});

describe("clearActivePostDrafts", () => {
  it("marks all active rows as posted and returns the count", async () => {
    vi.mocked(prisma.postDraft.updateMany).mockResolvedValue({ count: 4 } as never);

    const count = await clearActivePostDrafts();

    expect(prisma.postDraft.updateMany).toHaveBeenCalledWith({
      where: { postedAt: null },
      data: { postedAt: expect.any(Date) },
    });
    expect(count).toBe(4);
  });
});

describe("deleteStalePostDrafts", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-03T15:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("deletes rows created before the start of today in America/Sao_Paulo", async () => {
    vi.mocked(prisma.postDraft.deleteMany).mockResolvedValue({ count: 7 } as never);

    const count = await deleteStalePostDrafts();

    expect(prisma.postDraft.deleteMany).toHaveBeenCalledWith({
      where: { createdAt: { lt: new Date("2026-08-03T08:00:00.000Z") } },
    });
    expect(count).toBe(7);
  });
});

describe("getPostDraftById", () => {
  it("looks up a single row by id", async () => {
    vi.mocked(prisma.postDraft.findUnique).mockResolvedValue({ id: "cd1" } as never);

    const result = await getPostDraftById("cd1");

    expect(prisma.postDraft.findUnique).toHaveBeenCalledWith({ where: { id: "cd1" } });
    expect(result).toEqual({ id: "cd1" });
  });
});
