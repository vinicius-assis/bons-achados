import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/amazon/session", () => ({
  getSession: vi.fn(),
  saveSession: vi.fn().mockResolvedValue(undefined),
}));

import { GET, POST } from "@/app/api/admin/amazon/session/route";
import { getSession, saveSession } from "@/lib/amazon/session";
import { ADMIN_SESSION_COOKIE, createSessionToken } from "@/lib/adminSession";

function authHeader() {
  return { cookie: `${ADMIN_SESSION_COOKIE}=${createSessionToken()}` };
}

describe("GET /api/admin/amazon/session", () => {
  beforeEach(() => {
    process.env.ADMIN_USER = "admin";
    process.env.ADMIN_PASSWORD = "test-password";
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.ADMIN_USER;
    delete process.env.ADMIN_PASSWORD;
  });

  it("returns 401 without calling getSession when the session cookie is missing or invalid", async () => {
    const request = new NextRequest("http://localhost/api/admin/amazon/session");

    const response = await GET(request);

    expect(response.status).toBe(401);
    expect(getSession).not.toHaveBeenCalled();
  });

  it("returns hasSession: false when no session is stored", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const request = new NextRequest("http://localhost/api/admin/amazon/session", {
      headers: authHeader(),
    });

    const response = await GET(request);
    const body = await response.json();

    expect(body).toEqual({ hasSession: false });
  });

  it("returns hasSession: true when a session is stored", async () => {
    vi.mocked(getSession).mockResolvedValue({ cookieHeader: "a=b" });
    const request = new NextRequest("http://localhost/api/admin/amazon/session", {
      headers: authHeader(),
    });

    const response = await GET(request);
    const body = await response.json();

    expect(body).toEqual({ hasSession: true });
  });
});

describe("POST /api/admin/amazon/session", () => {
  const REAL_CURL = `curl -b 'a=b; c=d'`;

  beforeEach(() => {
    process.env.ADMIN_USER = "admin";
    process.env.ADMIN_PASSWORD = "test-password";
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.ADMIN_USER;
    delete process.env.ADMIN_PASSWORD;
  });

  it("returns 401 without calling saveSession when the session cookie is missing or invalid", async () => {
    const request = new NextRequest("http://localhost/api/admin/amazon/session", {
      method: "POST",
      body: JSON.stringify({ curlCommand: REAL_CURL }),
    });

    const response = await POST(request);

    expect(response.status).toBe(401);
    expect(saveSession).not.toHaveBeenCalled();
  });

  it("parses the curl command and saves the session", async () => {
    const request = new NextRequest("http://localhost/api/admin/amazon/session", {
      method: "POST",
      headers: authHeader(),
      body: JSON.stringify({ curlCommand: REAL_CURL }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(saveSession).toHaveBeenCalledWith("a=b; c=d");
    expect(body).toEqual({ saved: true });
  });

  it("returns 400 when curlCommand is missing", async () => {
    const request = new NextRequest("http://localhost/api/admin/amazon/session", {
      method: "POST",
      headers: authHeader(),
      body: JSON.stringify({}),
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(saveSession).not.toHaveBeenCalled();
  });

  it("returns 400 when the curl command has no Cookie header", async () => {
    const request = new NextRequest("http://localhost/api/admin/amazon/session", {
      method: "POST",
      headers: authHeader(),
      body: JSON.stringify({ curlCommand: "curl https://example.com" }),
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(saveSession).not.toHaveBeenCalled();
  });
});
