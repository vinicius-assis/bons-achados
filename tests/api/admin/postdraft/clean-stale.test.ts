import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/postdraft/store", () => ({
  deleteStalePostDrafts: vi.fn(),
}));

import { POST } from "@/app/api/admin/postdraft/clean-stale/route";
import { deleteStalePostDrafts } from "@/lib/postdraft/store";
import { ADMIN_SESSION_COOKIE, createSessionToken } from "@/lib/adminSession";

function authHeader() {
  return { cookie: `${ADMIN_SESSION_COOKIE}=${createSessionToken()}` };
}

describe("POST /api/admin/postdraft/clean-stale", () => {
  beforeEach(() => {
    process.env.ADMIN_PASSWORD = "test-password";
  });
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.ADMIN_PASSWORD;
  });

  it("returns 401 without deleting when the session cookie is missing or invalid", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api/admin/postdraft/clean-stale", { method: "POST" })
    );

    expect(response.status).toBe(401);
    expect(deleteStalePostDrafts).not.toHaveBeenCalled();
  });

  it("deletes stale drafts and returns the count", async () => {
    vi.mocked(deleteStalePostDrafts).mockResolvedValue(5);

    const response = await POST(
      new NextRequest("http://localhost/api/admin/postdraft/clean-stale", {
        method: "POST",
        headers: authHeader(),
      })
    );
    const body = await response.json();

    expect(body).toEqual({ deleted: 5 });
  });
});
