import { timingSafeEqual } from "crypto";

function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) {
    // Still run a constant-time comparison so a mismatched length doesn't
    // finish faster than a same-length mismatch and leak the real length.
    timingSafeEqual(bufferA, bufferA);
    return false;
  }
  return timingSafeEqual(bufferA, bufferB);
}

export function isValidAdminCredentials(username: string, password: string): boolean {
  const expectedUsername = process.env.ADMIN_USER ?? "";
  const expectedPassword = process.env.ADMIN_PASSWORD ?? "";
  return safeEqual(username, expectedUsername) && safeEqual(password, expectedPassword);
}
