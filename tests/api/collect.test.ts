import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/mercadolivre/collect", () => ({
  collectMercadoLivreDeals: vi.fn().mockResolvedValue([{ productId: "MLB1" }]),
}));
vi.mock("@/lib/products/upsert", () => ({
  upsertProducts: vi.fn().mockResolvedValue(1),
}));

import { POST } from "@/app/api/collect/route";

describe("POST /api/collect", () => {
  beforeEach(() => {
    process.env.COLLECT_SECRET = "test-secret";
  });

  it("rejects requests without the correct secret", async () => {
    const request = new NextRequest("http://localhost/api/collect", { method: "POST" });
    const response = await POST(request);
    expect(response.status).toBe(401);
  });

  it("collects and upserts when the secret matches", async () => {
    const request = new NextRequest("http://localhost/api/collect", {
      method: "POST",
      headers: { "x-collect-secret": "test-secret" },
    });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ collected: 1 });
  });
});
