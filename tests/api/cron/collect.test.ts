import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/collect/amazon", () => ({ collectAmazon: vi.fn() }));
vi.mock("@/lib/collect/mercadolivre", () => ({ collectMercadoLivre: vi.fn() }));
vi.mock("@/lib/collect/shopee", () => ({ collectShopee: vi.fn() }));
vi.mock("@/lib/highlights/store", () => ({ deleteStaleHighlights: vi.fn() }));

import { POST } from "@/app/api/cron/collect/route";
import { collectAmazon } from "@/lib/collect/amazon";
import { collectMercadoLivre } from "@/lib/collect/mercadolivre";
import { collectShopee } from "@/lib/collect/shopee";
import { deleteStaleHighlights } from "@/lib/highlights/store";

const OK_RESULT = { attempted: 10, inserted: 8, skipped: 2 };

describe("POST /api/cron/collect", () => {
  beforeEach(() => {
    process.env.CRON_COLLECT_SECRET = "test-secret";
  });
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.CRON_COLLECT_SECRET;
  });

  function buildRequest(secret: string | null) {
    return new Request("http://localhost/api/cron/collect", {
      method: "POST",
      headers: secret ? { authorization: `Bearer ${secret}` } : {},
    });
  }

  it("returns 401 without calling any collector when the bearer secret is missing or wrong", async () => {
    const response = await POST(buildRequest("wrong-secret"));

    expect(response.status).toBe(401);
    expect(collectAmazon).not.toHaveBeenCalled();
    expect(collectMercadoLivre).not.toHaveBeenCalled();
    expect(collectShopee).not.toHaveBeenCalled();
  });

  it("returns 401 when the secret is unset, even if the header literally says 'Bearer undefined'", async () => {
    delete process.env.CRON_COLLECT_SECRET;

    const response = await POST(
      new Request("http://localhost/api/cron/collect", {
        method: "POST",
        headers: { authorization: "Bearer undefined" },
      })
    );

    expect(response.status).toBe(401);
  });

  it("calls all three collectors and returns 200 with their results when none fails", async () => {
    vi.mocked(collectAmazon).mockResolvedValue(OK_RESULT);
    vi.mocked(collectMercadoLivre).mockResolvedValue(OK_RESULT);
    vi.mocked(collectShopee).mockResolvedValue(OK_RESULT);

    const response = await POST(buildRequest("test-secret"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ amazon: OK_RESULT, mercadoLivre: OK_RESULT, shopee: OK_RESULT });
  });

  it("returns 207 when one marketplace reports an error, without dropping the others' results", async () => {
    const failedResult = { attempted: 0, inserted: 0, skipped: 0, error: "session_expired" };
    vi.mocked(collectAmazon).mockResolvedValue(failedResult);
    vi.mocked(collectMercadoLivre).mockResolvedValue(OK_RESULT);
    vi.mocked(collectShopee).mockResolvedValue(OK_RESULT);

    const response = await POST(buildRequest("test-secret"));
    const body = await response.json();

    expect(response.status).toBe(207);
    expect(body).toEqual({ amazon: failedResult, mercadoLivre: OK_RESULT, shopee: OK_RESULT });
  });

  it("runs the three collectors even if one of them rejects instead of resolving", async () => {
    vi.mocked(collectAmazon).mockRejectedValue(new Error("unexpected"));
    vi.mocked(collectMercadoLivre).mockResolvedValue(OK_RESULT);
    vi.mocked(collectShopee).mockResolvedValue(OK_RESULT);

    const response = await POST(buildRequest("test-secret"));
    const body = await response.json();

    expect(response.status).toBe(207);
    expect(body.amazon.error).toBeDefined();
    expect(body.mercadoLivre).toEqual(OK_RESULT);
    expect(body.shopee).toEqual(OK_RESULT);
  });

  it("clears stale highlights before collecting", async () => {
    vi.mocked(collectAmazon).mockResolvedValue(OK_RESULT);
    vi.mocked(collectMercadoLivre).mockResolvedValue(OK_RESULT);
    vi.mocked(collectShopee).mockResolvedValue(OK_RESULT);

    await POST(buildRequest("test-secret"));

    expect(deleteStaleHighlights).toHaveBeenCalled();
  });
});
