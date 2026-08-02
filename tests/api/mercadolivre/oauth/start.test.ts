import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

import { GET } from "@/app/api/mercadolivre/oauth/start/route";

describe("GET /api/mercadolivre/oauth/start", () => {
  const originalSecret = process.env.COLLECT_SECRET;
  const originalClientId = process.env.ML_CLIENT_ID;
  const originalRedirectUri = process.env.ML_REDIRECT_URI;

  beforeEach(() => {
    process.env.COLLECT_SECRET = "test-secret";
    process.env.ML_CLIENT_ID = "client-id";
    process.env.ML_REDIRECT_URI = "http://localhost/api/mercadolivre/oauth/callback";
  });

  afterEach(() => {
    process.env.COLLECT_SECRET = originalSecret;
    process.env.ML_CLIENT_ID = originalClientId;
    process.env.ML_REDIRECT_URI = originalRedirectUri;
  });

  it("rejects requests with no secret", async () => {
    const request = new NextRequest("http://localhost/api/mercadolivre/oauth/start");

    const response = await GET(request);

    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("rejects requests with the wrong secret", async () => {
    const request = new NextRequest(
      "http://localhost/api/mercadolivre/oauth/start?secret=wrong"
    );

    const response = await GET(request);

    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("redirects and sets all three cookies when the secret matches", async () => {
    const request = new NextRequest(
      "http://localhost/api/mercadolivre/oauth/start?secret=test-secret"
    );

    const response = await GET(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBeTruthy();

    const cookies = response.cookies;
    expect(cookies.get("ml_oauth_state")?.value).toBeTruthy();
    expect(cookies.get("ml_oauth_verifier")?.value).toBeTruthy();
    expect(cookies.get("ml_oauth_authorized")?.value).toBeTruthy();
  });
});
