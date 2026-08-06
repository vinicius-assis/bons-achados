import { describe, it, expect, vi, afterEach } from "vitest";
import { getSession, saveSession } from "@/lib/amazon/session";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    amazonSession: {
      findUnique: vi.fn(),
      upsert: vi.fn().mockResolvedValue({}),
    },
  },
}));

describe("amazon session", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("getSession returns null when no row exists", async () => {
    vi.mocked(prisma.amazonSession.findUnique).mockResolvedValue(null);

    const session = await getSession();

    expect(session).toBeNull();
  });

  it("getSession returns the stored cookieHeader", async () => {
    vi.mocked(prisma.amazonSession.findUnique).mockResolvedValue({
      id: 1,
      cookieHeader: "a=b; c=d",
      updatedAt: new Date(),
    });

    const session = await getSession();

    expect(session).toEqual({ cookieHeader: "a=b; c=d" });
  });

  it("saveSession upserts the single row by id 1", async () => {
    await saveSession("a=b; c=d");

    expect(prisma.amazonSession.upsert).toHaveBeenCalledWith({
      where: { id: 1 },
      create: { id: 1, cookieHeader: "a=b; c=d" },
      update: { cookieHeader: "a=b; c=d" },
    });
  });
});
