import { describe, it, expect, vi, afterEach } from "vitest";
import { refreshAccessToken } from "@/lib/mercadolivre/auth";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    mercadoLivreAuth: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

describe("refreshAccessToken", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("throws when no token has been stored yet", async () => {
    vi.mocked(prisma.mercadoLivreAuth.findUnique).mockResolvedValue(null);

    await expect(refreshAccessToken()).rejects.toThrow(
      "Mercado Livre auth not configured — visit /api/mercadolivre/oauth/start to authorize"
    );
  });

  it("exchanges the stored refresh token for a new pair and persists it", async () => {
    vi.mocked(prisma.mercadoLivreAuth.findUnique).mockResolvedValue({
      id: 1,
      accessToken: "old-access",
      refreshToken: "old-refresh",
      updatedAt: new Date(),
    });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: "new-access", refresh_token: "new-refresh" }),
    } as Response);

    const token = await refreshAccessToken();

    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.mercadolibre.com/oauth/token",
      expect.objectContaining({ method: "POST" })
    );
    expect(prisma.mercadoLivreAuth.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { accessToken: "new-access", refreshToken: "new-refresh" },
    });
    expect(token).toBe("new-access");
  });

  it("throws when the token endpoint responds with an error status", async () => {
    vi.mocked(prisma.mercadoLivreAuth.findUnique).mockResolvedValue({
      id: 1,
      accessToken: "old-access",
      refreshToken: "old-refresh",
      updatedAt: new Date(),
    });
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 400 } as Response);

    await expect(refreshAccessToken()).rejects.toThrow(
      "Mercado Livre token refresh failed: 400"
    );
  });
});
