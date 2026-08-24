import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  fetchAccessToken,
  searchItems,
  getItems,
  AmazonCreatorsApiError,
  __resetRequestPacerForTests,
} from "@/lib/amazon/creatorsApiClient";

// The pacer's "last request" timestamp is module-level state shared across
// every test in this file. Reset it before each test so pacing delays from
// one test never bleed into the next — these tests only care about request
// shape/parsing, not real-time spacing (that's covered in "request pacing").
beforeEach(() => {
  __resetRequestPacerForTests();
});

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

const SEARCH_RESPONSE = {
  searchResult: {
    items: [
      {
        asin: "B0GQWF5JD1",
        detailPageURL: "https://www.amazon.com.br/dp/B0GQWF5JD1?tag=bonsachados0f-20&linkCode=ogi",
        itemInfo: { title: { displayValue: "Apple iPhone 17 de 256 GB" } },
        images: { primary: { medium: { url: "https://m.media-amazon.com/images/I/abc._SL160_.jpg" } } },
        offersV2: {
          listings: [
            {
              price: {
                money: { amount: 5887.78, currency: "BRL" },
                savingBasis: { money: { amount: 7999.0 } },
                savings: { percentage: 26 },
              },
            },
          ],
        },
      },
      {
        // No offersV2 at all — must be dropped, price is required.
        asin: "B0NOOFFER",
        detailPageURL: "https://www.amazon.com.br/dp/B0NOOFFER?tag=bonsachados0f-20",
        itemInfo: { title: { displayValue: "Sem oferta" } },
      },
    ],
  },
};

describe("searchItems", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.AMAZON_AFFILIATE_TAG;
  });

  it("throws before calling fetch when AMAZON_AFFILIATE_TAG is not set", async () => {
    global.fetch = vi.fn();

    await expect(searchItems("eletrônicos", 1, "token")).rejects.toThrow("AMAZON_AFFILIATE_TAG is not set");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("posts keywords/partnerTag/marketplace/pagination and parses items", async () => {
    process.env.AMAZON_AFFILIATE_TAG = "bonsachados0f-20";
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => SEARCH_RESPONSE,
    } as Response);

    const items = await searchItems("eletrônicos", 2, "token-abc");

    expect(global.fetch).toHaveBeenCalledWith(
      "https://creatorsapi.amazon/catalog/v1/searchItems",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer token-abc",
          "x-marketplace": "www.amazon.com.br",
        }),
      })
    );
    const sentBody = JSON.parse(vi.mocked(global.fetch).mock.calls[0][1]!.body as string);
    expect(sentBody).toEqual({
      keywords: "eletrônicos",
      partnerTag: "bonsachados0f-20",
      marketplace: "www.amazon.com.br",
      itemPage: 2,
      itemCount: 10,
      resources: ["images.primary.medium", "itemInfo.title", "offersV2.listings.price"],
    });

    expect(items).toEqual([
      {
        asin: "B0GQWF5JD1",
        title: "Apple iPhone 17 de 256 GB",
        price: 5887.78,
        oldPrice: 7999.0,
        discount: 26,
        image: "https://m.media-amazon.com/images/I/abc._SL160_.jpg",
        affiliateLink: "https://www.amazon.com.br/dp/B0GQWF5JD1?tag=bonsachados0f-20&linkCode=ogi",
      },
    ]);
  });

  it("omits keywords from the body when the query is empty, since Amazon rejects an empty string", async () => {
    process.env.AMAZON_AFFILIATE_TAG = "bonsachados0f-20";
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ searchResult: { items: [] } }) } as Response);

    await searchItems("", 1, "token", { searchIndex: "Electronics" });

    const sentBody = JSON.parse(vi.mocked(global.fetch).mock.calls[0][1]!.body as string);
    expect(sentBody).not.toHaveProperty("keywords");
  });

  it("includes optional filters only when provided", async () => {
    process.env.AMAZON_AFFILIATE_TAG = "bonsachados0f-20";
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ searchResult: { items: [] } }) } as Response);

    await searchItems("celular", 1, "token", {
      searchIndex: "Electronics",
      sortBy: "Price:LowToHigh",
      brand: "Samsung",
      minPrice: 1000,
      maxPrice: 500000,
      prime: true,
    });

    const sentBody = JSON.parse(vi.mocked(global.fetch).mock.calls[0][1]!.body as string);
    expect(sentBody).toMatchObject({
      searchIndex: "Electronics",
      sortBy: "Price:LowToHigh",
      brand: "Samsung",
      minPrice: 1000,
      maxPrice: 500000,
      deliveryFlags: ["Prime"],
    });
  });

  it("omits deliveryFlags when prime is false or omitted", async () => {
    process.env.AMAZON_AFFILIATE_TAG = "bonsachados0f-20";
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ searchResult: { items: [] } }) } as Response);

    await searchItems("celular", 1, "token", { prime: false });

    const sentBody = JSON.parse(vi.mocked(global.fetch).mock.calls[0][1]!.body as string);
    expect(sentBody.deliveryFlags).toBeUndefined();
  });

  it("throws AmazonCreatorsApiError with rateLimited=true on a 429 response", async () => {
    process.env.AMAZON_AFFILIATE_TAG = "bonsachados0f-20";
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 429 } as Response);

    await expect(searchItems("celular", 1, "token")).rejects.toThrow(AmazonCreatorsApiError);
    try {
      await searchItems("celular", 1, "token");
    } catch (error) {
      expect((error as AmazonCreatorsApiError).rateLimited).toBe(true);
    }
  });

  it("returns an empty array when searchResult.items is missing", async () => {
    process.env.AMAZON_AFFILIATE_TAG = "bonsachados0f-20";
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) } as Response);

    expect(await searchItems("celular", 1, "token")).toEqual([]);
  });
});

describe("getItems", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.AMAZON_AFFILIATE_TAG;
  });

  it("posts itemIds/itemIdType and parses offer fields only", async () => {
    process.env.AMAZON_AFFILIATE_TAG = "bonsachados0f-20";
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        itemResults: {
          items: [
            {
              asin: "B0GQWF5JD1",
              detailPageURL: "https://www.amazon.com.br/dp/B0GQWF5JD1?tag=bonsachados0f-20",
              itemInfo: { title: { displayValue: "Apple iPhone 17 de 256 GB" } },
              offersV2: { listings: [{ price: { money: { amount: 5500 }, savingBasis: { money: { amount: 7999 } }, savings: { percentage: 31 } } }] },
            },
          ],
        },
      }),
    } as Response);

    const items = await getItems(["B0GQWF5JD1"], "token-abc");

    const sentBody = JSON.parse(vi.mocked(global.fetch).mock.calls[0][1]!.body as string);
    expect(sentBody).toEqual({
      itemIds: ["B0GQWF5JD1"],
      itemIdType: "ASIN",
      partnerTag: "bonsachados0f-20",
      marketplace: "www.amazon.com.br",
      resources: ["itemInfo.title", "offersV2.listings.price"],
    });
    expect(items).toEqual([
      {
        asin: "B0GQWF5JD1",
        title: "Apple iPhone 17 de 256 GB",
        price: 5500,
        oldPrice: 7999,
        discount: 31,
        image: "",
        affiliateLink: "https://www.amazon.com.br/dp/B0GQWF5JD1?tag=bonsachados0f-20",
      },
    ]);
  });

  it("returns an empty array when itemResults.items is missing", async () => {
    process.env.AMAZON_AFFILIATE_TAG = "bonsachados0f-20";
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) } as Response);

    expect(await getItems(["B01"], "token")).toEqual([]);
  });
});

describe("request pacing", () => {
  beforeEach(() => {
    __resetRequestPacerForTests();
    vi.useFakeTimers();
    process.env.AMAZON_CREATORS_CLIENT_ID = "client-id";
    process.env.AMAZON_CREATORS_CLIENT_SECRET = "client-secret";
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ access_token: "tok" }),
    } as Response);
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.AMAZON_CREATORS_CLIENT_ID;
    delete process.env.AMAZON_CREATORS_CLIENT_SECRET;
  });

  it("spaces two back-to-back requests by ~1100ms", async () => {
    const first = fetchAccessToken();
    await vi.advanceTimersByTimeAsync(0);
    await first;
    expect(global.fetch).toHaveBeenCalledTimes(1);

    const second = fetchAccessToken();

    // Not enough time has passed yet — the second call must still be waiting.
    await vi.advanceTimersByTimeAsync(500);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    // Advancing past the full interval lets the second call proceed.
    await vi.advanceTimersByTimeAsync(600);
    await second;
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("does not wait when the interval has already elapsed", async () => {
    const first = fetchAccessToken();
    await vi.advanceTimersByTimeAsync(0);
    await first;
    expect(global.fetch).toHaveBeenCalledTimes(1);

    // Let plenty of real (fake) time pass between requests.
    await vi.advanceTimersByTimeAsync(5000);

    const second = fetchAccessToken();
    // No further timer advance needed — the call should resolve immediately.
    await vi.advanceTimersByTimeAsync(0);
    await second;
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});
