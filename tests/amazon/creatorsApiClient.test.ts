import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchAccessToken, searchItems, getItems, AmazonCreatorsApiError } from "@/lib/amazon/creatorsApiClient";

describe("fetchAccessToken", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.AMAZON_CREATORS_CLIENT_ID;
    delete process.env.AMAZON_CREATORS_CLIENT_SECRET;
  });

  it("posts client-credentials to the LwA token endpoint and returns the access token", async () => {
    process.env.AMAZON_CREATORS_CLIENT_ID = "client-id";
    process.env.AMAZON_CREATORS_CLIENT_SECRET = "client-secret";
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ access_token: "Atc|abc", scope: "creatorsapi::default", token_type: "bearer", expires_in: 3600 }),
    } as Response);

    const token = await fetchAccessToken();

    expect(token).toBe("Atc|abc");
    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.amazon.com/auth/o2/token",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "content-type": "application/json" }),
        body: JSON.stringify({
          grant_type: "client_credentials",
          client_id: "client-id",
          client_secret: "client-secret",
          scope: "creatorsapi::default",
        }),
      })
    );
  });

  it("throws before calling fetch when credentials are not set", async () => {
    global.fetch = vi.fn();

    await expect(fetchAccessToken()).rejects.toThrow("AMAZON_CREATORS_CLIENT_ID/SECRET is not set");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("throws AmazonCreatorsApiError on a non-ok response", async () => {
    process.env.AMAZON_CREATORS_CLIENT_ID = "client-id";
    process.env.AMAZON_CREATORS_CLIENT_SECRET = "client-secret";
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401 } as Response);

    await expect(fetchAccessToken()).rejects.toThrow(AmazonCreatorsApiError);
  });

  it("throws AmazonCreatorsApiError when the response has no access_token", async () => {
    process.env.AMAZON_CREATORS_CLIENT_ID = "client-id";
    process.env.AMAZON_CREATORS_CLIENT_SECRET = "client-secret";
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) } as Response);

    await expect(fetchAccessToken()).rejects.toThrow(AmazonCreatorsApiError);
  });
});
