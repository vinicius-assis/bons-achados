import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/postdraft/store", () => ({
  deleteStalePostDrafts: vi.fn(),
}));

import { POST } from "@/app/api/cron/postdraft-cleanup/route";
import { deleteStalePostDrafts } from "@/lib/postdraft/store";

describe("POST /api/cron/postdraft-cleanup", () => {
  beforeEach(() => {
    process.env.POSTDRAFT_CLEANUP_SECRET = "test-secret";
  });
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.POSTDRAFT_CLEANUP_SECRET;
  });

  it("returns 401 without deleting when the bearer secret is missing or wrong", async () => {
    const response = await POST(
      new Request("http://localhost/api/cron/postdraft-cleanup", {
        method: "POST",
        headers: { authorization: "Bearer wrong-secret" },
      })
    );

    expect(response.status).toBe(401);
    expect(deleteStalePostDrafts).not.toHaveBeenCalled();
  });

  it("returns 401 without deleting when the secret is unset, even if the header literally says 'Bearer undefined'", async () => {
    delete process.env.POSTDRAFT_CLEANUP_SECRET;

    const response = await POST(
      new Request("http://localhost/api/cron/postdraft-cleanup", {
        method: "POST",
        headers: { authorization: "Bearer undefined" },
      })
    );

    expect(response.status).toBe(401);
    expect(deleteStalePostDrafts).not.toHaveBeenCalled();
  });

  it("deletes stale rows and returns the count when the secret matches", async () => {
    vi.mocked(deleteStalePostDrafts).mockResolvedValue(3);

    const response = await POST(
      new Request("http://localhost/api/cron/postdraft-cleanup", {
        method: "POST",
        headers: { authorization: "Bearer test-secret" },
      })
    );
    const body = await response.json();

    expect(body).toEqual({ deleted: 3 });
  });
});
