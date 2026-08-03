import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  ADMIN_SESSION_COOKIE,
  createSessionToken,
  isValidSessionToken,
  isAuthorizedAdminRequest,
} from "@/lib/adminSession";

describe("adminSession", () => {
  beforeEach(() => {
    process.env.ADMIN_PASSWORD = "test-password";
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.ADMIN_PASSWORD;
  });

  it("accepts a token it just created", () => {
    const token = createSessionToken();
    expect(isValidSessionToken(token)).toBe(true);
  });

  it("rejects a missing token", () => {
    expect(isValidSessionToken(undefined)).toBe(false);
  });

  it("rejects a malformed token", () => {
    expect(isValidSessionToken("not-a-real-token")).toBe(false);
  });

  it("rejects a token signed with a different secret", () => {
    const token = createSessionToken();
    process.env.ADMIN_PASSWORD = "different-password";
    expect(isValidSessionToken(token)).toBe(false);
  });

  it("rejects an expired token", () => {
    vi.useFakeTimers();
    const token = createSessionToken();
    vi.advanceTimersByTime(13 * 60 * 60 * 1000); // past the 12h TTL
    expect(isValidSessionToken(token)).toBe(false);
  });

  it("isAuthorizedAdminRequest reads the cookie off the request", () => {
    const token = createSessionToken();
    const authorized = new NextRequest("http://localhost/admin", {
      headers: { cookie: `${ADMIN_SESSION_COOKIE}=${token}` },
    });
    const unauthorized = new NextRequest("http://localhost/admin");

    expect(isAuthorizedAdminRequest(authorized)).toBe(true);
    expect(isAuthorizedAdminRequest(unauthorized)).toBe(false);
  });
});
