import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isValidAdminCredentials } from "@/lib/adminAuth";

describe("isValidAdminCredentials", () => {
  beforeEach(() => {
    process.env.ADMIN_USER = "admin";
    process.env.ADMIN_PASSWORD = "test-password";
  });

  afterEach(() => {
    delete process.env.ADMIN_USER;
    delete process.env.ADMIN_PASSWORD;
  });

  it("returns false for the wrong password", () => {
    expect(isValidAdminCredentials("admin", "wrong-password")).toBe(false);
  });

  it("returns false for the wrong user", () => {
    expect(isValidAdminCredentials("someone-else", "test-password")).toBe(false);
  });

  it("returns true for correct credentials", () => {
    expect(isValidAdminCredentials("admin", "test-password")).toBe(true);
  });

  it("returns true when the password itself contains a colon", () => {
    process.env.ADMIN_PASSWORD = "pass:word";
    expect(isValidAdminCredentials("admin", "pass:word")).toBe(true);
  });

  it("returns false (without throwing) when the supplied password is a different length than the real one", () => {
    process.env.ADMIN_PASSWORD = "a-fairly-long-password";
    expect(() => isValidAdminCredentials("admin", "short")).not.toThrow();
    expect(isValidAdminCredentials("admin", "short")).toBe(false);
  });
});
