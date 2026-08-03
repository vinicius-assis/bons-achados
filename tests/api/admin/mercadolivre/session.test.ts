import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/mercadolivre/session", () => ({
  getSession: vi.fn(),
  saveSession: vi.fn().mockResolvedValue(undefined),
}));

import { GET, POST } from "@/app/api/admin/mercadolivre/session/route";
import { getSession, saveSession } from "@/lib/mercadolivre/session";

const AUTH_HEADER = { authorization: `Basic ${Buffer.from("admin:test-password").toString("base64")}` };

describe("GET /api/admin/mercadolivre/session", () => {
  beforeEach(() => {
    process.env.ADMIN_USER = "admin";
    process.env.ADMIN_PASSWORD = "test-password";
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.ADMIN_USER;
    delete process.env.ADMIN_PASSWORD;
  });

  it("returns 401 without calling getSession when Basic Auth is missing or invalid", async () => {
    const request = new NextRequest("http://localhost/api/admin/mercadolivre/session");

    const response = await GET(request);

    expect(response.status).toBe(401);
    expect(getSession).not.toHaveBeenCalled();
  });

  it("returns hasSession: false when no session is stored", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const request = new NextRequest("http://localhost/api/admin/mercadolivre/session", {
      headers: AUTH_HEADER,
    });

    const response = await GET(request);
    const body = await response.json();

    expect(body).toEqual({ hasSession: false });
  });

  it("returns hasSession: true when a session is stored", async () => {
    vi.mocked(getSession).mockResolvedValue({ cookieHeader: "a=b", csrfToken: "t" });
    const request = new NextRequest("http://localhost/api/admin/mercadolivre/session", {
      headers: AUTH_HEADER,
    });

    const response = await GET(request);
    const body = await response.json();

    expect(body).toEqual({ hasSession: true });
  });
});

describe("POST /api/admin/mercadolivre/session", () => {
  beforeEach(() => {
    process.env.ADMIN_USER = "admin";
    process.env.ADMIN_PASSWORD = "test-password";
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.ADMIN_USER;
    delete process.env.ADMIN_PASSWORD;
  });

  it("returns 401 without calling saveSession when Basic Auth is missing or invalid", async () => {
    const request = new NextRequest("http://localhost/api/admin/mercadolivre/session", {
      method: "POST",
      body: JSON.stringify({ cookieHeader: "a=b", csrfToken: "token123" }),
    });

    const response = await POST(request);

    expect(response.status).toBe(401);
    expect(saveSession).not.toHaveBeenCalled();
  });

  it("saves the session and returns saved: true", async () => {
    const request = new NextRequest("http://localhost/api/admin/mercadolivre/session", {
      method: "POST",
      headers: AUTH_HEADER,
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
      headers: AUTH_HEADER,
      body: JSON.stringify({ cookieHeader: "" }),
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(saveSession).not.toHaveBeenCalled();
  });
});
