import { describe, it, expect, vi, afterEach } from "vitest";
import { shopeeRequest, ShopeeApiError } from "@/lib/shopee/client";

describe("shopeeRequest", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.SHOPEE_APP_ID;
    delete process.env.SHOPEE_APP_SECRET;
  });

  it("signs the request exactly as Shopee's documented worked example", async () => {
    process.env.SHOPEE_APP_ID = "123456";
    process.env.SHOPEE_APP_SECRET = "demo";
    vi.spyOn(Date, "now").mockReturnValue(1577836800 * 1000);
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { brandOffer: { nodes: [] } } }),
    } as Response);

    const query = "{\nbrandOffer{\n nodes{\n commissionRate\n offerName\n }\n}\n}";
    await shopeeRequest(query);

    expect(global.fetch).toHaveBeenCalledWith(
      "https://open-api.affiliate.shopee.com.br/graphql",
      expect.objectContaining({
        method: "POST",
        body: '{"query":"{\\nbrandOffer{\\n nodes{\\n commissionRate\\n offerName\\n }\\n}\\n}"}',
      })
    );
    const init = vi.mocked(global.fetch).mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers["content-type"]).toBe("application/json");
    expect(headers["Authorization"]).toBe(
      "SHA256 Credential=123456, Timestamp=1577836800, Signature=43a5dabcfb6598dfcaefc377088988228ddc512202fee19d2ceca1909cba60c6"
    );
  });

  it("returns the data field on success", async () => {
    process.env.SHOPEE_APP_ID = "id";
    process.env.SHOPEE_APP_SECRET = "secret";
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { hello: "world" } }),
    } as Response);

    const result = await shopeeRequest<{ hello: string }>("{ hello }");

    expect(result).toEqual({ hello: "world" });
  });

  it("passes variables through in the JSON body", async () => {
    process.env.SHOPEE_APP_ID = "id";
    process.env.SHOPEE_APP_SECRET = "secret";
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: {} }),
    } as Response);

    await shopeeRequest("query($k: String!){ x(k: $k) }", { k: "value" });

    const init = vi.mocked(global.fetch).mock.calls[0][1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({
      query: "query($k: String!){ x(k: $k) }",
      variables: { k: "value" },
    });
  });

  it("throws before calling fetch when SHOPEE_APP_ID is not set", async () => {
    delete process.env.SHOPEE_APP_ID;
    process.env.SHOPEE_APP_SECRET = "secret";
    global.fetch = vi.fn();

    await expect(shopeeRequest("{ x }")).rejects.toThrow("SHOPEE_APP_ID is not set");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("throws before calling fetch when SHOPEE_APP_SECRET is not set", async () => {
    process.env.SHOPEE_APP_ID = "id";
    delete process.env.SHOPEE_APP_SECRET;
    global.fetch = vi.fn();

    await expect(shopeeRequest("{ x }")).rejects.toThrow("SHOPEE_APP_SECRET is not set");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("throws ShopeeApiError with the response status on a non-ok response", async () => {
    process.env.SHOPEE_APP_ID = "id";
    process.env.SHOPEE_APP_SECRET = "secret";
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 } as Response);

    await expect(shopeeRequest("{ x }")).rejects.toThrow(ShopeeApiError);
  });

  it("throws ShopeeApiError with the GraphQL error message and code when errors[] is present", async () => {
    process.env.SHOPEE_APP_ID = "id";
    process.env.SHOPEE_APP_SECRET = "secret";
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        errors: [{ message: "Invalid Signature", path: "x", extensions: { code: 10020 } }],
      }),
    } as Response);

    try {
      await shopeeRequest("{ x }");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ShopeeApiError);
      expect((error as ShopeeApiError).message).toBe("Invalid Signature");
      expect((error as ShopeeApiError).code).toBe(10020);
    }
  });

  it("passes an abort signal with a timeout to fetch", async () => {
    process.env.SHOPEE_APP_ID = "id";
    process.env.SHOPEE_APP_SECRET = "secret";
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: {} }),
    } as Response);

    await shopeeRequest("{ x }");

    expect(global.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });
});
