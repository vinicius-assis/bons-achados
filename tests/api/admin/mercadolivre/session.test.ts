import { describe, it, expect, vi, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/mercadolivre/session", () => ({
  getSession: vi.fn(),
  saveSession: vi.fn().mockResolvedValue(undefined),
}));

import { GET, POST } from "@/app/api/admin/mercadolivre/session/route";
import { getSession, saveSession } from "@/lib/mercadolivre/session";

describe("GET /api/admin/mercadolivre/session", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns hasSession: false when no session is stored", async () => {
    vi.mocked(getSession).mockResolvedValue(null);

    const response = await GET();
    const body = await response.json();

    expect(body).toEqual({ hasSession: false });
  });

  it("returns hasSession: true when a session is stored", async () => {
    vi.mocked(getSession).mockResolvedValue({ cookieHeader: "a=b", csrfToken: "t" });

    const response = await GET();
    const body = await response.json();

    expect(body).toEqual({ hasSession: true });
  });
});

describe("POST /api/admin/mercadolivre/session", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("saves the session and returns saved: true", async () => {
    const request = new NextRequest("http://localhost/api/admin/mercadolivre/session", {
      method: "POST",
      body: JSON.stringify({ cookieHeader: "a=b; c=d", csrfToken: "token123" }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(saveSession).toHaveBeenCalledWith("a=b; c=d", "token123");
    expect(body).toEqual({ saved: true });
  });

  it("returns 400 when cookieHeader or csrfToken is missing", async () => {
    const request = new NextRequest("http://localhost/api/admin/mercadolivre/session", {
      method: "POST",
      body: JSON.stringify({ cookieHeader: "" }),
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(saveSession).not.toHaveBeenCalled();
  });
});
