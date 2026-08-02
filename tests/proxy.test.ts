import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";

describe("proxy (admin Basic Auth)", () => {
  beforeEach(() => {
    process.env.ADMIN_USER = "admin";
    process.env.ADMIN_PASSWORD = "test-password";
  });

  afterEach(() => {
    delete process.env.ADMIN_USER;
    delete process.env.ADMIN_PASSWORD;
  });

  it("rejects requests without an Authorization header", () => {
    const request = new NextRequest("http://localhost/admin/mercadolivre");

    const response = proxy(request);

    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toBe('Basic realm="Admin"');
  });

  it("rejects requests with the wrong password", () => {
    const encoded = Buffer.from("admin:wrong-password").toString("base64");
    const request = new NextRequest("http://localhost/admin/mercadolivre", {
      headers: { authorization: `Basic ${encoded}` },
    });

    const response = proxy(request);

    expect(response.status).toBe(401);
  });

  it("rejects requests with the wrong user", () => {
    const encoded = Buffer.from("someone-else:test-password").toString("base64");
    const request = new NextRequest("http://localhost/admin/mercadolivre", {
      headers: { authorization: `Basic ${encoded}` },
    });

    const response = proxy(request);

    expect(response.status).toBe(401);
  });

  it("allows requests with the correct credentials", () => {
    const encoded = Buffer.from("admin:test-password").toString("base64");
    const request = new NextRequest("http://localhost/admin/mercadolivre", {
      headers: { authorization: `Basic ${encoded}` },
    });

    const response = proxy(request);

    expect(response.status).toBe(200);
  });
});
