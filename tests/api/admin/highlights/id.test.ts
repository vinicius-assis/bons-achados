import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/highlights/store", () => ({
  removeHighlight: vi.fn(),
}));

import { DELETE } from "@/app/api/admin/highlights/[id]/route";
import { removeHighlight } from "@/lib/highlights/store";
import { ADMIN_SESSION_COOKIE, createSessionToken } from "@/lib/adminSession";

function authHeader() {
  return { cookie: `${ADMIN_SESSION_COOKIE}=${createSessionToken()}` };
}

describe("DELETE /api/admin/highlights/[id]", () => {
  beforeEach(() => {
    process.env.ADMIN_PASSWORD = "test-password";
  });
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.ADMIN_PASSWORD;
  });

  it("returns 401 without removing when the session cookie is missing or invalid", async () => {
    const response = await DELETE(
      new NextRequest("http://localhost/api/admin/highlights/hl1", { method: "DELETE" }),
      { params: Promise.resolve({ id: "hl1" }) }
    );

    expect(response.status).toBe(401);
    expect(removeHighlight).not.toHaveBeenCalled();
  });

  it("removes the highlight and returns 200", async () => {
    vi.mocked(removeHighlight).mockResolvedValue(undefined);

    const response = await DELETE(
      new NextRequest("http://localhost/api/admin/highlights/hl1", {
        method: "DELETE",
        headers: authHeader(),
      }),
      { params: Promise.resolve({ id: "hl1" }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ removed: true });
    expect(removeHighlight).toHaveBeenCalledWith("hl1");
  });
});
