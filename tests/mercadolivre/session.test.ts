import { describe, it, expect, vi, afterEach } from "vitest";
import { getSession, saveSession } from "@/lib/mercadolivre/session";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    mercadoLivreSession: {
      findUnique: vi.fn(),
      upsert: vi.fn().mockResolvedValue({}),
    },
  },
}));

describe("session", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("getSession returns null when no row exists", async () => {
    vi.mocked(prisma.mercadoLivreSession.findUnique).mockResolvedValue(null);

    const session = await getSession();

    expect(session).toBeNull();
  });

  it("getSession returns the stored cookieHeader and csrfToken", async () => {
    vi.mocked(prisma.mercadoLivreSession.findUnique).mockResolvedValue({
      id: 1,
      cookieHeader: "a=b; c=d",
      csrfToken: "token123",
      updatedAt: new Date(),
    });

    const session = await getSession();

    expect(session).toEqual({ cookieHeader: "a=b; c=d", csrfToken: "token123" });
  });

  it("saveSession upserts the single row by id 1", async () => {
    await saveSession("a=b; c=d", "token123");

    expect(prisma.mercadoLivreSession.upsert).toHaveBeenCalledWith({
      where: { id: 1 },
      create: { id: 1, cookieHeader: "a=b; c=d", csrfToken: "token123" },
      update: { cookieHeader: "a=b; c=d", csrfToken: "token123" },
    });
  });
});
