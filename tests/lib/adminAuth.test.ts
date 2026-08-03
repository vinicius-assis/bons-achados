import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isAuthorizedAdminRequest } from "@/lib/adminAuth";

describe("isAuthorizedAdminRequest", () => {
  beforeEach(() => {
    process.env.ADMIN_USER = "admin";
    process.env.ADMIN_PASSWORD = "test-password";
  });

  afterEach(() => {
    delete process.env.ADMIN_USER;
    delete process.env.ADMIN_PASSWORD;
  });

  it("returns false when the Authorization header is missing", () => {
    const request = new Request("http://localhost/admin/mercadolivre");

    expect(isAuthorizedAdminRequest(request)).toBe(false);
  });

  it("returns false for the wrong password", () => {
    const encoded = Buffer.from("admin:wrong-password").toString("base64");
    const request = new Request("http://localhost/admin/mercadolivre", {
      headers: { authorization: `Basic ${encoded}` },
    });

    expect(isAuthorizedAdminRequest(request)).toBe(false);
  });

  it("returns false for the wrong user", () => {
    const encoded = Buffer.from("someone-else:test-password").toString("base64");
    const request = new Request("http://localhost/admin/mercadolivre", {
      headers: { authorization: `Basic ${encoded}` },
    });

    expect(isAuthorizedAdminRequest(request)).toBe(false);
  });

  it("returns true for correct credentials", () => {
    const encoded = Buffer.from("admin:test-password").toString("base64");
    const request = new Request("http://localhost/admin/mercadolivre", {
      headers: { authorization: `Basic ${encoded}` },
    });

    expect(isAuthorizedAdminRequest(request)).toBe(true);
  });

  it("returns true when the password itself contains a colon", () => {
    process.env.ADMIN_PASSWORD = "pass:word";
    const encoded = Buffer.from("admin:pass:word").toString("base64");
    const request = new Request("http://localhost/admin/mercadolivre", {
      headers: { authorization: `Basic ${encoded}` },
    });

    expect(isAuthorizedAdminRequest(request)).toBe(true);
  });
});
