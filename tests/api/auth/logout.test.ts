import { describe, it, expect } from "vitest";
import { POST } from "@/app/api/auth/logout/route";
import { ADMIN_SESSION_COOKIE } from "@/lib/adminSession";

describe("POST /api/auth/logout", () => {
  it("clears the session cookie", async () => {
    const response = await POST();

    expect(response.status).toBe(200);
    const cookie = response.cookies.get(ADMIN_SESSION_COOKIE);
    expect(cookie?.value).toBe("");
  });
});
