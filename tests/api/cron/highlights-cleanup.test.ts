import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/highlights/store", () => ({
  deleteStaleHighlights: vi.fn(),
}));

import { POST } from "@/app/api/cron/highlights-cleanup/route";
import { deleteStaleHighlights } from "@/lib/highlights/store";

describe("POST /api/cron/highlights-cleanup", () => {
  beforeEach(() => {
    process.env.HIGHLIGHTS_CLEANUP_SECRET = "test-secret";
  });
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.HIGHLIGHTS_CLEANUP_SECRET;
  });

  it("returns 401 without deleting when the bearer secret is missing or wrong", async () => {
    const response = await POST(
      new Request("http://localhost/api/cron/highlights-cleanup", {
        method: "POST",
        headers: { authorization: "Bearer wrong-secret" },
      })
    );

    expect(response.status).toBe(401);
    expect(deleteStaleHighlights).not.toHaveBeenCalled();
  });

  it("returns 401 without deleting when the secret is unset, even if the header literally says 'Bearer undefined'", async () => {
    delete process.env.HIGHLIGHTS_CLEANUP_SECRET;

    const response = await POST(
      new Request("http://localhost/api/cron/highlights-cleanup", {
        method: "POST",
        headers: { authorization: "Bearer undefined" },
      })
    );

    expect(response.status).toBe(401);
    expect(deleteStaleHighlights).not.toHaveBeenCalled();
  });

  it("deletes stale rows and returns the count when the secret matches", async () => {
    vi.mocked(deleteStaleHighlights).mockResolvedValue(3);

    const response = await POST(
      new Request("http://localhost/api/cron/highlights-cleanup", {
        method: "POST",
        headers: { authorization: "Bearer test-secret" },
      })
    );
    const body = await response.json();

    expect(body).toEqual({ deleted: 3 });
  });
});
