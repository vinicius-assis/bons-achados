import { describe, it, expect, vi, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    mercadoLivreAuth: {
      upsert: vi.fn().mockResolvedValue({}),
    },
  },
}));

import { GET } from "@/app/api/mercadolivre/oauth/callback/route";
import { prisma } from "@/lib/prisma";

function requestWithCookies(url: string, cookie: string) {
  return new NextRequest(url, { headers: { cookie } });
}

describe("GET /api/mercadolivre/oauth/callback", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("rejects when the state does not match the cookie", async () => {
    global.fetch = vi.fn();
    const request = requestWithCookies(
      "http://localhost/api/mercadolivre/oauth/callback?code=abc&state=wrong",
      "ml_oauth_state=expected; ml_oauth_verifier=verifier123"
    );

    const response = await GET(request);

    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("rejects when there is no state cookie at all", async () => {
    global.fetch = vi.fn();
    const request = new NextRequest(
      "http://localhost/api/mercadolivre/oauth/callback?code=abc&state=expected"
    );

    const response = await GET(request);

    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("exchanges the code for tokens and stores them when state matches", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: "new-access", refresh_token: "new-refresh" }),
    } as Response);
    const request = requestWithCookies(
      "http://localhost/api/mercadolivre/oauth/callback?code=auth-code&state=expected",
      "ml_oauth_state=expected; ml_oauth_verifier=verifier123"
    );

    const response = await GET(request);

    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.mercadolibre.com/oauth/token",
      expect.objectContaining({ method: "POST" })
    );
    expect(prisma.mercadoLivreAuth.upsert).toHaveBeenCalledWith({
      where: { id: 1 },
      create: { id: 1, accessToken: "new-access", refreshToken: "new-refresh" },
      update: { accessToken: "new-access", refreshToken: "new-refresh" },
    });
    expect(response.status).toBe(200);
  });

  it("returns 502 when the token exchange fails", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 400 } as Response);
    const request = requestWithCookies(
      "http://localhost/api/mercadolivre/oauth/callback?code=auth-code&state=expected",
      "ml_oauth_state=expected; ml_oauth_verifier=verifier123"
    );

    const response = await GET(request);

    expect(response.status).toBe(502);
    expect(prisma.mercadoLivreAuth.upsert).not.toHaveBeenCalled();
  });
});
