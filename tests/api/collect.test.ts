import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/mercadolivre/auth", () => ({
  refreshAccessToken: vi.fn().mockResolvedValue("test-token"),
}));
vi.mock("@/lib/mercadolivre/collect", () => ({
  collectMercadoLivreDeals: vi.fn().mockResolvedValue([{ productId: "MLB1" }]),
}));
vi.mock("@/lib/products/upsert", () => ({
  upsertProducts: vi.fn().mockResolvedValue(1),
}));

import { POST } from "@/app/api/collect/route";
import { refreshAccessToken } from "@/lib/mercadolivre/auth";
import { collectMercadoLivreDeals } from "@/lib/mercadolivre/collect";

describe("POST /api/collect", () => {
  beforeEach(() => {
    process.env.COLLECT_SECRET = "test-secret";
    vi.mocked(refreshAccessToken).mockClear();
    vi.mocked(collectMercadoLivreDeals).mockClear();
  });

  it("rejects requests without the correct secret", async () => {
    const request = new NextRequest("http://localhost/api/collect", { method: "POST" });
    const response = await POST(request);
    expect(response.status).toBe(401);
    expect(refreshAccessToken).not.toHaveBeenCalled();
  });

  it("refreshes the access token, collects, and upserts when the secret matches", async () => {
    const request = new NextRequest("http://localhost/api/collect", {
      method: "POST",
      headers: { "x-collect-secret": "test-secret" },
    });
    const response = await POST(request);
    const body = await response.json();

    expect(refreshAccessToken).toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect(body).toEqual({ collected: 1 });
  });

  it("returns 500 when the token refresh fails", async () => {
    vi.mocked(refreshAccessToken).mockRejectedValueOnce(new Error("Mercado Livre auth not configured"));

    const request = new NextRequest("http://localhost/api/collect", {
      method: "POST",
      headers: { "x-collect-secret": "test-secret" },
    });
    const response = await POST(request);

    expect(response.status).toBe(500);
  });
});
