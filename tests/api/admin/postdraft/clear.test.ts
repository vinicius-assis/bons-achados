import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/postdraft/store", () => ({
  clearActivePostDrafts: vi.fn(),
}));

import { POST } from "@/app/api/admin/postdraft/clear/route";
import { clearActivePostDrafts } from "@/lib/postdraft/store";
import { ADMIN_SESSION_COOKIE, createSessionToken } from "@/lib/adminSession";

function authHeader() {
  return { cookie: `${ADMIN_SESSION_COOKIE}=${createSessionToken()}` };
}

describe("POST /api/admin/postdraft/clear", () => {
  beforeEach(() => {
    process.env.ADMIN_PASSWORD = "test-password";
  });
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.ADMIN_PASSWORD;
  });

  it("returns 401 without clearing when the session cookie is missing or invalid", async () => {
    const response = await POST(new NextRequest("http://localhost/api/admin/postdraft/clear", { method: "POST" }));

    expect(response.status).toBe(401);
    expect(clearActivePostDrafts).not.toHaveBeenCalled();
  });

  it("clears the active queue and returns the count", async () => {
    vi.mocked(clearActivePostDrafts).mockResolvedValue(5);

    const response = await POST(
      new NextRequest("http://localhost/api/admin/postdraft/clear", {
        method: "POST",
        headers: authHeader(),
      })
    );
    const body = await response.json();

    expect(body).toEqual({ cleared: 5 });
  });
});
