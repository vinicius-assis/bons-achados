import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/loginRateLimit", () => ({
  getClientIp: vi.fn(() => "203.0.113.5"),
  isRateLimited: vi.fn(),
  recordFailedLoginAttempt: vi.fn(),
}));

import { POST } from "@/app/api/auth/login/route";
import { ADMIN_SESSION_COOKIE, isValidSessionToken } from "@/lib/adminSession";

function buildRequest(body: unknown) {
  return new Request("http://localhost/api/auth/login", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/login", () => {
  beforeEach(() => {
    process.env.ADMIN_USER = "admin";
    process.env.ADMIN_PASSWORD = "test-password";
  });

  beforeEach(async () => {
    const { isRateLimited } = await import("@/lib/loginRateLimit");
    vi.mocked(isRateLimited).mockResolvedValue(false);
  });

  afterEach(() => {
    delete process.env.ADMIN_USER;
    delete process.env.ADMIN_PASSWORD;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 for wrong credentials and sets no cookie", async () => {
    const response = await POST(buildRequest({ username: "admin", password: "wrong" }));

    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("returns 401 for a malformed body", async () => {
    const response = await POST(
      new Request("http://localhost/api/auth/login", { method: "POST", body: "not-json" })
    );

    expect(response.status).toBe(401);
  });

  it("sets a valid session cookie for correct credentials", async () => {
    const response = await POST(buildRequest({ username: "admin", password: "test-password" }));

    expect(response.status).toBe(200);
    const cookie = response.cookies.get(ADMIN_SESSION_COOKIE);
    expect(cookie).toBeDefined();
    expect(isValidSessionToken(cookie!.value)).toBe(true);
    expect(cookie!.httpOnly).toBe(true);
  });

  it("returns 429 without checking credentials when the IP is rate limited", async () => {
    const { isRateLimited } = await import("@/lib/loginRateLimit");
    vi.mocked(isRateLimited).mockResolvedValue(true);

    const response = await POST(buildRequest({ username: "admin", password: "test-password" }));

    expect(response.status).toBe(429);
  });

  it("records a failed attempt when credentials are wrong", async () => {
    const { isRateLimited, recordFailedLoginAttempt } = await import("@/lib/loginRateLimit");
    vi.mocked(isRateLimited).mockResolvedValue(false);

    await POST(buildRequest({ username: "admin", password: "wrong" }));

    expect(recordFailedLoginAttempt).toHaveBeenCalledWith("203.0.113.5");
  });

  it("does not record an attempt when credentials are correct", async () => {
    const { isRateLimited, recordFailedLoginAttempt } = await import("@/lib/loginRateLimit");
    vi.mocked(isRateLimited).mockResolvedValue(false);

    await POST(buildRequest({ username: "admin", password: "test-password" }));

    expect(recordFailedLoginAttempt).not.toHaveBeenCalled();
  });
});
