import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/amazon/session", () => ({ getAmazonWebCookie: vi.fn(), saveAmazonWebCookie: vi.fn() }));

import { GET, POST } from "@/app/api/admin/amazon/session/route";
import { getAmazonWebCookie, saveAmazonWebCookie } from "@/lib/amazon/session";
import { ADMIN_SESSION_COOKIE, createSessionToken } from "@/lib/adminSession";

function request(method: string, body?: unknown, authorized = true) {
  return new NextRequest("http://localhost/api/admin/amazon/session", {
    method,
    headers: authorized ? { cookie: `${ADMIN_SESSION_COOKIE}=${createSessionToken()}` } : {},
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("/api/admin/amazon/session", () => {
  beforeEach(() => {
    process.env.ADMIN_USER = "admin";
    process.env.ADMIN_PASSWORD = "test-password";
  });
  afterEach(() => vi.clearAllMocks());

  it("rejects unauthenticated requests", async () => {
    expect((await GET(request("GET", undefined, false))).status).toBe(401);
    expect((await POST(request("POST", { curlCommand: "x" }, false))).status).toBe(401);
  });

  it("reports whether a session is saved", async () => {
    vi.mocked(getAmazonWebCookie).mockResolvedValue("a=b");
    expect(await (await GET(request("GET"))).json()).toEqual({ hasSession: true });
    vi.mocked(getAmazonWebCookie).mockResolvedValue(null);
    expect(await (await GET(request("GET"))).json()).toEqual({ hasSession: false });
  });

  it("extracts only the Cookie header from a pasted curl and saves it", async () => {
    const curlCommand = "curl --url 'https://www.amazon.com.br/x' -H 'accept: */*' -b 'session-id=abc; ubid=def' -H 'referer: y'";
    const response = await POST(request("POST", { curlCommand }));

    expect(response.status).toBe(200);
    expect(saveAmazonWebCookie).toHaveBeenCalledWith("session-id=abc; ubid=def");
  });

  it("returns 400 when the curl has no cookie", async () => {
    const response = await POST(request("POST", { curlCommand: "curl --url 'https://x'" }));

    expect(response.status).toBe(400);
    expect(saveAmazonWebCookie).not.toHaveBeenCalled();
  });
});
