import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";
import { ADMIN_SESSION_COOKIE, createSessionToken } from "@/lib/adminSession";

describe("proxy (admin session auth)", () => {
  beforeEach(() => {
    process.env.ADMIN_PASSWORD = "test-password";
  });

  afterEach(() => {
    delete process.env.ADMIN_PASSWORD;
  });

  it("redirects /admin/* to /login when the session cookie is missing", () => {
    const request = new NextRequest("http://localhost/admin/mercadolivre");

    const response = proxy(request);

    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe("/admin/mercadolivre");
  });

  it("returns 401 JSON for /api/admin/* when the session cookie is missing", async () => {
    const request = new NextRequest("http://localhost/api/admin/mercadolivre/search");

    const response = proxy(request);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
  });

  it("rejects an invalid session cookie", () => {
    const request = new NextRequest("http://localhost/admin/mercadolivre", {
      headers: { cookie: `${ADMIN_SESSION_COOKIE}=garbage` },
    });

    const response = proxy(request);

    expect(response.status).toBe(307);
  });

  it("allows requests with a valid session cookie", () => {
    const token = createSessionToken();
    const request = new NextRequest("http://localhost/admin/mercadolivre", {
      headers: { cookie: `${ADMIN_SESSION_COOKIE}=${token}` },
    });

    const response = proxy(request);

    expect(response.status).toBe(200);
  });

  it("does not intercept / (public vitrine page), authenticated or not", () => {
    const unauthenticated = proxy(new NextRequest("http://localhost/"));
    expect(unauthenticated.status).toBe(200);

    const token = createSessionToken();
    const authenticated = proxy(
      new NextRequest("http://localhost/", {
        headers: { cookie: `${ADMIN_SESSION_COOKIE}=${token}` },
      })
    );
    expect(authenticated.status).toBe(200);
  });

  it("does not intercept public routes outside /admin", () => {
    const request = new NextRequest("http://localhost/some-public-page");

    const response = proxy(request);

    expect(response.status).toBe(200);
  });
});
