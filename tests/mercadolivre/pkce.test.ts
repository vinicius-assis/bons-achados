import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import {
  generateCodeVerifier,
  codeChallengeFromVerifier,
  generateState,
} from "@/lib/mercadolivre/pkce";

describe("pkce", () => {
  it("generateCodeVerifier returns a url-safe string of at least 43 characters", () => {
    const verifier = generateCodeVerifier();
    expect(verifier).toMatch(/^[A-Za-z0-9\-_]+$/);
    expect(verifier.length).toBeGreaterThanOrEqual(43);
  });

  it("codeChallengeFromVerifier returns the sha256 base64url digest of the verifier", () => {
    const verifier = "test-verifier-value";
    const expected = crypto.createHash("sha256").update(verifier).digest("base64url");

    expect(codeChallengeFromVerifier(verifier)).toBe(expected);
  });

  it("generateState returns a 32-character hex string", () => {
    const state = generateState();
    expect(state).toMatch(/^[0-9a-f]{32}$/);
  });

  it("generateCodeVerifier and generateState return different values on each call", () => {
    expect(generateCodeVerifier()).not.toBe(generateCodeVerifier());
    expect(generateState()).not.toBe(generateState());
  });
});
