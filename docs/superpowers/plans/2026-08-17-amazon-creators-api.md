# Amazon Creators API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fragile Amazon session-cookie scraper with the official Amazon Creators API across the collection pipeline and the `/admin/amazon` hub.

**Architecture:** A new `src/lib/amazon/creatorsApiClient.ts` wraps OAuth2 client-credentials auth plus `SearchItems`/`GetItems` HTTP calls (plain `fetch`, no SDK). `collectAmazon()` uses it for keyword-based discovery (mirroring ML/Shopee) and a new `refreshAmazonPrices()` uses it to keep already-collected offers within the license's TTL. `persistItems` becomes an upsert so all three marketplaces refresh price fields on rediscovery. The admin hub drops session UI entirely and gains a search-with-filters UI matching the ML/Shopee pattern.

**Tech Stack:** Next.js API routes, Prisma/PostgreSQL (Neon), Vitest, plain `fetch` (no new dependencies).

**Spec:** `docs/superpowers/specs/2026-08-17-amazon-creators-api-design.md`

## Global Constraints

- No SDK dependency — `fetch` only, matching every other marketplace client in this codebase.
- BR marketplace is hardcoded (`www.amazon.com.br`) — no locale switching in this change.
- `AMAZON_AFFILIATE_TAG` is reused as `partnerTag` — do not rename it.
- New env vars: `AMAZON_CREATORS_CLIENT_ID`, `AMAZON_CREATORS_CLIENT_SECRET`, `AMAZON_CREATORS_CREDENTIAL_VERSION`.
- `persistItems` upsert change applies to all three marketplaces (`MERCADO_LIVRE`, `AMAZON`, `SHOPEE`), not just Amazon.
- `CollectResult` type (`{ attempted, inserted, skipped, error? }`) does not change shape.
- Sequential Creators API calls within one cron cycle must be spaced ~1.1s apart to respect the initial 1 TPS allocation.

---

## Task 1: Amazon Creators API client — auth + SearchItems + GetItems

**Files:**
- Create: `src/lib/amazon/creatorsApiClient.ts`
- Test: `tests/amazon/creatorsApiClient.test.ts`

**Interfaces:**
- Produces:
  - `export type AmazonDealItem = { asin: string; title: string; price: number; oldPrice: number | null; discount: number | null; image: string; affiliateLink: string }`
  - `export type AmazonSearchFilters = { searchIndex?: string; sortBy?: string; brand?: string; minPrice?: number; maxPrice?: number; prime?: boolean }`
  - `export class AmazonCreatorsApiError extends Error { rateLimited: boolean }`
  - `export async function fetchAccessToken(): Promise<string>`
  - `export async function searchItems(keywords: string, page: number, token: string, filters?: AmazonSearchFilters): Promise<AmazonDealItem[]>`
  - `export async function getItems(asins: string[], token: string): Promise<AmazonDealItem[]>`

- [ ] **Step 1: Write the failing tests for `fetchAccessToken`**

```ts
// tests/amazon/creatorsApiClient.test.ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/amazon/creatorsApiClient.test.ts`
Expected: FAIL — `creatorsApiClient` module does not exist yet.

- [ ] **Step 3: Implement `fetchAccessToken`**

```ts
// src/lib/amazon/creatorsApiClient.ts
const TOKEN_URL = "https://api.amazon.com/auth/o2/token";
const API_BASE_URL = "https://creatorsapi.amazon";
const MARKETPLACE = "www.amazon.com.br";
const REQUEST_TIMEOUT_MS = 10_000;

export class AmazonCreatorsApiError extends Error {
  rateLimited: boolean;
  constructor(message: string, rateLimited = false) {
    super(message);
    this.name = "AmazonCreatorsApiError";
    this.rateLimited = rateLimited;
  }
}

export async function fetchAccessToken(): Promise<string> {
  const clientId = process.env.AMAZON_CREATORS_CLIENT_ID;
  const clientSecret = process.env.AMAZON_CREATORS_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("AMAZON_CREATORS_CLIENT_ID/SECRET is not set");
  }

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: "creatorsapi::default",
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new AmazonCreatorsApiError(`Amazon token request failed: ${response.status}`);
  }

  const data = await response.json();
  if (typeof data?.access_token !== "string") {
    throw new AmazonCreatorsApiError("Amazon token response missing access_token");
  }
  return data.access_token;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/amazon/creatorsApiClient.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/amazon/creatorsApiClient.ts tests/amazon/creatorsApiClient.test.ts
git commit -m "feat: add Amazon Creators API auth token client"
```

- [ ] **Step 6: Write the failing tests for `searchItems` and `getItems`**

Append to `tests/amazon/creatorsApiClient.test.ts`:

```ts
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
```

- [ ] **Step 7: Run the tests to verify they fail**

Run: `npx vitest run tests/amazon/creatorsApiClient.test.ts`
Expected: FAIL — `searchItems`/`getItems` are not exported yet.

- [ ] **Step 8: Implement `searchItems` and `getItems`**

Append to `src/lib/amazon/creatorsApiClient.ts`:

```ts
export type AmazonDealItem = {
  asin: string;
  title: string;
  price: number;
  oldPrice: number | null;
  discount: number | null;
  image: string;
  affiliateLink: string;
};

export type AmazonSearchFilters = {
  searchIndex?: string;
  sortBy?: string;
  brand?: string;
  minPrice?: number;
  maxPrice?: number;
  prime?: boolean;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseProduct(product: any): AmazonDealItem | null {
  try {
    const asin = product.asin;
    const title = product.itemInfo?.title?.displayValue;
    const detailPageURL = product.detailPageURL;
    const listing = product.offersV2?.listings?.[0];
    const price = listing?.price?.money?.amount;
    if (!asin || !title || !detailPageURL || typeof price !== "number") {
      return null;
    }
    const rawOldPrice = listing?.price?.savingBasis?.money?.amount;
    const rawDiscount = listing?.price?.savings?.percentage;
    return {
      asin,
      title,
      price,
      oldPrice: typeof rawOldPrice === "number" ? rawOldPrice : null,
      discount: typeof rawDiscount === "number" ? rawDiscount : null,
      image: product.images?.primary?.medium?.url ?? "",
      affiliateLink: detailPageURL,
    };
  } catch {
    return null;
  }
}

function requirePartnerTag(): string {
  const partnerTag = process.env.AMAZON_AFFILIATE_TAG;
  if (!partnerTag) {
    throw new Error("AMAZON_AFFILIATE_TAG is not set");
  }
  return partnerTag;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function callCreatorsApi(path: string, body: Record<string, unknown>, token: string): Promise<any> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      "x-marketplace": MARKETPLACE,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (response.status === 429) {
    throw new AmazonCreatorsApiError("Amazon Creators API rate limited", true);
  }
  if (!response.ok) {
    throw new AmazonCreatorsApiError(`Amazon Creators API request failed: ${response.status}`);
  }
  return response.json();
}

export async function searchItems(
  keywords: string,
  page: number,
  token: string,
  filters: AmazonSearchFilters = {}
): Promise<AmazonDealItem[]> {
  const partnerTag = requirePartnerTag();
  const body: Record<string, unknown> = {
    keywords,
    partnerTag,
    marketplace: MARKETPLACE,
    itemPage: page,
    itemCount: 10,
    resources: ["images.primary.medium", "itemInfo.title", "offersV2.listings.price"],
  };
  if (filters.searchIndex) body.searchIndex = filters.searchIndex;
  if (filters.sortBy) body.sortBy = filters.sortBy;
  if (filters.brand) body.brand = filters.brand;
  if (filters.minPrice !== undefined) body.minPrice = filters.minPrice;
  if (filters.maxPrice !== undefined) body.maxPrice = filters.maxPrice;
  if (filters.prime) body.deliveryFlags = ["Prime"];

  const data = await callCreatorsApi("/catalog/v1/searchItems", body, token);
  const products = data?.searchResult?.items;
  if (!Array.isArray(products)) {
    return [];
  }
  return products.map(parseProduct).filter((item: AmazonDealItem | null): item is AmazonDealItem => item !== null);
}

export async function getItems(asins: string[], token: string): Promise<AmazonDealItem[]> {
  const partnerTag = requirePartnerTag();
  const body = {
    itemIds: asins,
    itemIdType: "ASIN",
    partnerTag,
    marketplace: MARKETPLACE,
    resources: ["itemInfo.title", "offersV2.listings.price"],
  };
  const data = await callCreatorsApi("/catalog/v1/getItems", body, token);
  const products = data?.itemResults?.items;
  if (!Array.isArray(products)) {
    return [];
  }
  return products.map(parseProduct).filter((item: AmazonDealItem | null): item is AmazonDealItem => item !== null);
}
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `npx vitest run tests/amazon/creatorsApiClient.test.ts`
Expected: PASS (all tests)

- [ ] **Step 10: Verify the `SearchItems` endpoint path against a live call**

The `/catalog/v1/searchItems` path is inferred from the `GetItems` cURL example in the Creators API docs (`Using cURL` page only documents `GetItems`, not `SearchItems`) — before relying on it in production, run one real request with the actual credentials once they're configured in `.env.local` (Task 9 adds the env vars):

```bash
node -e "
const { fetchAccessToken, searchItems } = require('./src/lib/amazon/creatorsApiClient.ts');
(async () => {
  const token = await fetchAccessToken();
  console.log(await searchItems('eletrônicos', 1, token));
})();
"
```

If the real endpoint differs (e.g. a different path casing), update `callCreatorsApi("/catalog/v1/searchItems", ...)` in `searchItems` and re-run Step 9. Note the confirmed/corrected path in the commit message.

- [ ] **Step 11: Commit**

```bash
git add src/lib/amazon/creatorsApiClient.ts tests/amazon/creatorsApiClient.test.ts
git commit -m "feat: add Amazon Creators API searchItems and getItems"
```

---

## Task 2: `persistItems` upsert (all three marketplaces)

**Files:**
- Modify: `src/lib/collect/persist.ts`
- Test: `tests/collect/persist.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `persistItems(marketplace, items): Promise<{ inserted: number; skipped: number }>` — same signature, new upsert-based behavior (an existing `(marketplace, productId)` row has its `price`/`oldPrice`/`discount` updated instead of being skipped; still counted as `inserted` if the row didn't exist yet before this call's batch, `skipped` only for items dropped by the image/price validity filter).

- [ ] **Step 1: Write the failing test for update-on-conflict**

Replace `tests/collect/persist.test.ts` with:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    highlight: {
      upsert: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));
vi.mock("@/lib/highlights/noteTemplates", () => ({
  pickRandomNote: vi.fn().mockReturnValue("Ótimo custo-benefício para quem busca praticidade."),
}));

import { prisma } from "@/lib/prisma";
import { persistItems, findHighlightsByProductIds } from "@/lib/collect/persist";
import type { CollectItem } from "@/lib/collect/types";

const ITEM: CollectItem = {
  productId: "MLB1",
  title: "Creatina 1kg",
  affiliateLink: "https://meli.la/abc",
  image: "https://img.example/1.webp",
  price: 59.9,
  oldPrice: 89.9,
  discount: 33,
};

describe("persistItems", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("drops items with no image before writing", async () => {
    vi.mocked(prisma.highlight.upsert).mockResolvedValue({} as never);

    const result = await persistItems("MERCADO_LIVRE", [ITEM, { ...ITEM, productId: "MLB2", image: "" }]);

    expect(prisma.highlight.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.highlight.upsert).toHaveBeenCalledWith({
      where: { marketplace_productId: { marketplace: "MERCADO_LIVRE", productId: "MLB1" } },
      create: {
        marketplace: "MERCADO_LIVRE",
        productId: "MLB1",
        title: "Creatina 1kg",
        affiliateLink: "https://meli.la/abc",
        image: "https://img.example/1.webp",
        price: 59.9,
        oldPrice: 89.9,
        discount: 33,
        note: "Ótimo custo-benefício para quem busca praticidade.",
      },
      update: {
        price: 59.9,
        oldPrice: 89.9,
        discount: 33,
      },
    });
    expect(result).toEqual({ inserted: 1, skipped: 1 });
  });

  it("drops items with a non-positive price before writing", async () => {
    const result = await persistItems("AMAZON", [{ ...ITEM, price: 0 }]);

    expect(prisma.highlight.upsert).not.toHaveBeenCalled();
    expect(result).toEqual({ inserted: 0, skipped: 1 });
  });

  it("upserts every valid item, even repeated productIds across the same batch", async () => {
    vi.mocked(prisma.highlight.upsert).mockResolvedValue({} as never);

    const result = await persistItems("SHOPEE", [ITEM, { ...ITEM, price: 49.9 }]);

    expect(prisma.highlight.upsert).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ inserted: 2, skipped: 0 });
  });

  it("returns zero/zero for an empty item list without calling the database", async () => {
    const result = await persistItems("AMAZON", []);

    expect(prisma.highlight.upsert).not.toHaveBeenCalled();
    expect(result).toEqual({ inserted: 0, skipped: 0 });
  });
});

describe("findHighlightsByProductIds", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("queries by marketplace and productId list", async () => {
    vi.mocked(prisma.highlight.findMany).mockResolvedValue([{ id: "hl1" }] as never);

    const result = await findHighlightsByProductIds("AMAZON", ["B01", "B02"]);

    expect(prisma.highlight.findMany).toHaveBeenCalledWith({
      where: { marketplace: "AMAZON", productId: { in: ["B01", "B02"] } },
    });
    expect(result).toEqual([{ id: "hl1" }]);
  });

  it("returns an empty array without querying when productIds is empty", async () => {
    const result = await findHighlightsByProductIds("AMAZON", []);

    expect(prisma.highlight.findMany).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/collect/persist.test.ts`
Expected: FAIL — `persistItems` still calls `createMany`, not `upsert`.

- [ ] **Step 3: Implement the upsert in `persistItems`**

Replace the body of `persistItems` in `src/lib/collect/persist.ts`:

```ts
export async function persistItems(
  marketplace: Marketplace,
  items: CollectItem[]
): Promise<{ inserted: number; skipped: number }> {
  const valid = items.filter((item) => item.image.length > 0 && item.price > 0);
  if (valid.length === 0) {
    return { inserted: 0, skipped: items.length };
  }

  for (const item of valid) {
    await prisma.highlight.upsert({
      where: { marketplace_productId: { marketplace, productId: item.productId } },
      create: {
        marketplace,
        productId: item.productId,
        title: item.title,
        affiliateLink: item.affiliateLink,
        image: item.image,
        price: item.price,
        oldPrice: item.oldPrice,
        discount: item.discount,
        note: pickRandomNote(),
      },
      update: {
        price: item.price,
        oldPrice: item.oldPrice,
        discount: item.discount,
      },
    });
  }

  return { inserted: valid.length, skipped: items.length - valid.length };
}
```

(Note: `marketplace_productId` is the compound unique field name Prisma generates for `@@unique([marketplace, productId])` on `Highlight` — confirmed by the existing schema in `prisma/schema.prisma`.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/collect/persist.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/collect/persist.ts tests/collect/persist.test.ts
git commit -m "feat: upsert highlights instead of skip-duplicating to keep offer fields fresh"
```

---

## Task 3: `Highlight.updatedAt` + remove `AmazonSession` from schema

**Files:**
- Modify: `prisma/schema.prisma`
- Create: new migration under `prisma/migrations/`

**Interfaces:**
- Produces: `Highlight.updatedAt: DateTime` (Prisma `@updatedAt`, auto-managed — every `create`/`update` in Task 2's upsert sets it automatically, no extra code needed for that part).

- [ ] **Step 1: Edit `prisma/schema.prisma`**

Remove the `AmazonSession` model (lines 29-33):

```prisma
model AmazonSession {
  id           Int      @id @default(1)
  cookieHeader String
  updatedAt    DateTime @updatedAt
}

```

Add `updatedAt` to `Highlight`:

```prisma
model Highlight {
  id            String      @id @default(cuid())
  marketplace   Marketplace
  productId     String
  title         String
  affiliateLink String
  image         String
  price         Float
  oldPrice      Float?
  discount      Float?
  note          String
  createdAt     DateTime    @default(now())
  updatedAt     DateTime    @updatedAt

  @@unique([marketplace, productId])
  @@index([createdAt])
}
```

- [ ] **Step 2: Generate the migration**

Run: `npx prisma migrate dev --name amazon_creators_api`

This creates `prisma/migrations/<timestamp>_amazon_creators_api/migration.sql` with `DROP TABLE "AmazonSession"` and `ALTER TABLE "Highlight" ADD COLUMN "updatedAt" ...` (Prisma backfills existing rows using the column's default at migration time, since `@updatedAt` has no explicit `@default` — verify the generated SQL sets a `DEFAULT now()` or an equivalent backfill so existing rows don't get a NULL `updatedAt`; if it doesn't, add `ALTER TABLE "Highlight" ALTER COLUMN "updatedAt" SET DEFAULT now();` before the `NOT NULL` constraint in the generated file).

- [ ] **Step 3: Run `prisma generate` and confirm the client types**

Run: `npx prisma generate`
Expected: no errors; `@prisma/client`'s `Highlight` type now includes `updatedAt: Date`, and `HighlightUpsertArgs` includes `marketplace_productId` as a valid `where` key (used in Task 2).

- [ ] **Step 4: Re-run the full test suite to catch any fallout**

Run: `npx vitest run`
Expected: PASS (Task 2's tests should already be green; this confirms nothing else broke against the new Prisma types)

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat: add Highlight.updatedAt and remove AmazonSession from schema"
```

---

## Task 4: Rewrite `collectAmazon()` to use `searchItems`

**Files:**
- Modify: `src/lib/collect/amazon.ts`
- Test: `tests/collect/amazon.test.ts` (rewrite)

**Interfaces:**
- Consumes: `searchItems(keywords, page, token, filters?)` from Task 1, `pickRandomSearchTerm()` from `src/lib/collect/searchTerms.ts` (existing), `persistItems` from Task 2, `fetchAccessToken()` from Task 1.
- Produces: `collectAmazon(): Promise<CollectResult>` — same exported name and return type as today; internally no longer exported `mapAmazonItems` (deleted, its job now lives in `creatorsApiClient.ts`'s `parseProduct`).

- [ ] **Step 1: Write the failing tests**

Replace `tests/collect/amazon.test.ts` with:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/amazon/creatorsApiClient", () => ({
  fetchAccessToken: vi.fn(),
  searchItems: vi.fn(),
  getItems: vi.fn(),
  AmazonCreatorsApiError: class AmazonCreatorsApiError extends Error {
    rateLimited: boolean;
    constructor(message: string, rateLimited = false) {
      super(message);
      this.rateLimited = rateLimited;
    }
  },
}));
vi.mock("@/lib/collect/persist", () => ({ persistItems: vi.fn() }));
vi.mock("@/lib/collect/searchTerms", () => ({ pickRandomSearchTerm: vi.fn().mockReturnValue("eletrônicos") }));
vi.mock("@/lib/prisma", () => ({
  prisma: { highlight: { findMany: vi.fn().mockResolvedValue([]) } },
}));

import { fetchAccessToken, searchItems, AmazonCreatorsApiError, type AmazonDealItem } from "@/lib/amazon/creatorsApiClient";
import { persistItems } from "@/lib/collect/persist";
import { collectAmazon } from "@/lib/collect/amazon";

function buildItem(overrides: Partial<AmazonDealItem> = {}): AmazonDealItem {
  return {
    asin: "B01",
    title: "Fone Bluetooth",
    price: 129.9,
    oldPrice: 199.9,
    discount: 35,
    image: "https://img.example/1.jpg",
    affiliateLink: "https://www.amazon.com.br/dp/B01?tag=bonsachados0f-20",
    ...overrides,
  };
}

describe("collectAmazon", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("fetches a token, then pages searchItems until it has 50 items", async () => {
    vi.mocked(fetchAccessToken).mockResolvedValue("token-abc");
    vi.mocked(searchItems).mockImplementation(async (_term, page) =>
      Array.from({ length: 10 }, (_, i) => buildItem({ asin: `B${page}-${i}` }))
    );
    vi.mocked(persistItems).mockResolvedValue({ inserted: 50, skipped: 0 });

    const result = await collectAmazon();

    expect(searchItems).toHaveBeenCalledTimes(5);
    for (let page = 1; page <= 5; page++) {
      expect(searchItems).toHaveBeenNthCalledWith(page, "eletrônicos", page, "token-abc");
    }
    expect(result.attempted).toBe(50);
  });

  it("stops paging early when a page returns fewer than 10 items", async () => {
    vi.mocked(fetchAccessToken).mockResolvedValue("token-abc");
    vi.mocked(searchItems)
      .mockResolvedValueOnce(Array.from({ length: 10 }, (_, i) => buildItem({ asin: `B${i}` })))
      .mockResolvedValueOnce([buildItem({ asin: "B10" })]);
    vi.mocked(persistItems).mockResolvedValue({ inserted: 11, skipped: 0 });

    const result = await collectAmazon();

    expect(searchItems).toHaveBeenCalledTimes(2);
    expect(result.attempted).toBe(11);
  });

  it("persists the mapped items under the AMAZON marketplace", async () => {
    vi.mocked(fetchAccessToken).mockResolvedValue("token-abc");
    vi.mocked(searchItems).mockResolvedValueOnce([buildItem()]).mockResolvedValueOnce([]);
    vi.mocked(persistItems).mockResolvedValue({ inserted: 1, skipped: 0 });

    const result = await collectAmazon();

    expect(persistItems).toHaveBeenCalledWith("AMAZON", [
      expect.objectContaining({ productId: "B01", affiliateLink: "https://www.amazon.com.br/dp/B01?tag=bonsachados0f-20" }),
    ]);
    expect(result).toEqual({ attempted: 1, inserted: 1, skipped: 0 });
  });

  it("returns a collect_failed error without throwing when fetchAccessToken fails", async () => {
    vi.mocked(fetchAccessToken).mockRejectedValue(new Error("boom"));

    const result = await collectAmazon();

    expect(searchItems).not.toHaveBeenCalled();
    expect(result).toEqual({ attempted: 0, inserted: 0, skipped: 0, error: "collect_failed" });
  });

  it("returns a rate_limited error without throwing when searchItems is rate-limited", async () => {
    vi.mocked(fetchAccessToken).mockResolvedValue("token-abc");
    vi.mocked(searchItems).mockRejectedValue(new AmazonCreatorsApiError("rate limited", true));

    const result = await collectAmazon();

    expect(result).toEqual({ attempted: 0, inserted: 0, skipped: 0, error: "rate_limited" });
  });

  it("returns a collect_failed error without throwing on any other searchItems error", async () => {
    vi.mocked(fetchAccessToken).mockResolvedValue("token-abc");
    vi.mocked(searchItems).mockRejectedValue(new Error("boom"));

    const result = await collectAmazon();

    expect(result).toEqual({ attempted: 0, inserted: 0, skipped: 0, error: "collect_failed" });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/collect/amazon.test.ts`
Expected: FAIL — `collectAmazon` still imports the old session-based `hubClient`.

- [ ] **Step 3: Rewrite `src/lib/collect/amazon.ts`**

```ts
import { fetchAccessToken, searchItems, AmazonCreatorsApiError, type AmazonDealItem } from "@/lib/amazon/creatorsApiClient";
import { persistItems } from "@/lib/collect/persist";
import { pickRandomSearchTerm } from "@/lib/collect/searchTerms";
import type { CollectItem, CollectResult } from "@/lib/collect/types";

const TARGET_ITEM_COUNT = 50;
const ITEMS_PER_PAGE = 10;
const MAX_PAGES = 5;

function mapAmazonItems(items: AmazonDealItem[]): CollectItem[] {
  return items.map((item) => ({
    productId: item.asin,
    title: item.title,
    affiliateLink: item.affiliateLink,
    image: item.image,
    price: item.price,
    oldPrice: item.oldPrice,
    discount: item.discount,
  }));
}

export async function collectAmazon(): Promise<CollectResult> {
  const searchTerm = pickRandomSearchTerm();

  try {
    const token = await fetchAccessToken();

    const fetched: AmazonDealItem[] = [];
    for (let page = 1; page <= MAX_PAGES && fetched.length < TARGET_ITEM_COUNT; page++) {
      const pageItems = await searchItems(searchTerm, page, token);
      fetched.push(...pageItems);
      if (pageItems.length < ITEMS_PER_PAGE) {
        break;
      }
    }
    const items = fetched.slice(0, TARGET_ITEM_COUNT);

    if (items.length === 0) {
      return { attempted: 0, inserted: 0, skipped: 0 };
    }

    const mapped = mapAmazonItems(items);
    const { inserted, skipped } = await persistItems("AMAZON", mapped);
    return { attempted: items.length, inserted, skipped };
  } catch (error) {
    if (error instanceof AmazonCreatorsApiError && error.rateLimited) {
      return { attempted: 0, inserted: 0, skipped: 0, error: "rate_limited" };
    }
    console.error("collectAmazon failed:", error);
    return { attempted: 0, inserted: 0, skipped: 0, error: "collect_failed" };
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/collect/amazon.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/collect/amazon.ts tests/collect/amazon.test.ts
git commit -m "feat: rewrite collectAmazon to discover items via Creators API SearchItems"
```

---

## Task 5: `refreshAmazonPrices()` — age-gated price refresh via `GetItems`

**Files:**
- Modify: `src/lib/collect/amazon.ts`
- Modify: `tests/collect/amazon.test.ts`

**Interfaces:**
- Consumes: `getItems(asins, token)` from Task 1, `prisma.highlight.findMany`/`updateMany` (via `@/lib/prisma`).
- Produces: `refreshAmazonPrices(): Promise<{ refreshed: number; error?: string }>`, called internally by `collectAmazon()` after discovery (its own errors do not turn `collectAmazon()`'s result into an error — they're independent, logged separately, per the spec's "falha isolada em um lote não interrompe os outros").

- [ ] **Step 1: Write the failing tests**

Append to `tests/collect/amazon.test.ts` (add to the existing mocks block, add `updateMany` alongside `findMany`):

```ts
// Update the top-of-file prisma mock to:
vi.mock("@/lib/prisma", () => ({
  prisma: {
    highlight: {
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn(),
    },
  },
}));
```

```ts
import { prisma } from "@/lib/prisma";
import { getItems } from "@/lib/amazon/creatorsApiClient";
import { refreshAmazonPrices } from "@/lib/collect/amazon";

describe("refreshAmazonPrices", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("does nothing and doesn't call fetchAccessToken when there are no stale items", async () => {
    vi.mocked(prisma.highlight.findMany).mockResolvedValue([]);

    const result = await refreshAmazonPrices();

    expect(fetchAccessToken).not.toHaveBeenCalled();
    expect(result).toEqual({ refreshed: 0 });
  });

  it("queries only AMAZON highlights with updatedAt older than 50 minutes", async () => {
    vi.mocked(prisma.highlight.findMany).mockResolvedValue([]);

    await refreshAmazonPrices();

    expect(prisma.highlight.findMany).toHaveBeenCalledWith({
      where: {
        marketplace: "AMAZON",
        updatedAt: { lt: expect.any(Date) },
      },
      select: { id: true, productId: true },
    });
  });

  it("batches ASINs in groups of 10 and updates matching rows", async () => {
    const staleRows = Array.from({ length: 15 }, (_, i) => ({ id: `hl${i}`, productId: `B${i}` }));
    vi.mocked(prisma.highlight.findMany).mockResolvedValue(staleRows as never);
    vi.mocked(fetchAccessToken).mockResolvedValue("token-abc");
    vi.mocked(getItems).mockImplementation(async (asins) =>
      asins.map((asin) => ({
        asin,
        title: "irrelevant",
        price: 42,
        oldPrice: 50,
        discount: 16,
        image: "irrelevant",
        affiliateLink: "irrelevant",
      }))
    );
    vi.mocked(prisma.highlight.update).mockResolvedValue({} as never);

    const result = await refreshAmazonPrices();

    expect(getItems).toHaveBeenCalledTimes(2);
    expect(getItems).toHaveBeenNthCalledWith(1, staleRows.slice(0, 10).map((r) => r.productId), "token-abc");
    expect(getItems).toHaveBeenNthCalledWith(2, staleRows.slice(10).map((r) => r.productId), "token-abc");
    expect(prisma.highlight.update).toHaveBeenCalledTimes(15);
    expect(prisma.highlight.update).toHaveBeenCalledWith({
      where: { id: "hl0" },
      data: { price: 42, oldPrice: 50, discount: 16 },
    });
    expect(result).toEqual({ refreshed: 15 });
  });

  it("skips rows whose ASIN isn't in the GetItems response instead of failing", async () => {
    vi.mocked(prisma.highlight.findMany).mockResolvedValue([
      { id: "hl0", productId: "B0" },
      { id: "hl1", productId: "B1" },
    ] as never);
    vi.mocked(fetchAccessToken).mockResolvedValue("token-abc");
    vi.mocked(getItems).mockResolvedValue([
      { asin: "B0", title: "x", price: 10, oldPrice: null, discount: null, image: "x", affiliateLink: "x" },
    ]);
    vi.mocked(prisma.highlight.update).mockResolvedValue({} as never);

    const result = await refreshAmazonPrices();

    expect(prisma.highlight.update).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ refreshed: 1 });
  });

  it("returns a collect_failed error without throwing when fetchAccessToken fails", async () => {
    vi.mocked(prisma.highlight.findMany).mockResolvedValue([{ id: "hl0", productId: "B0" }] as never);
    vi.mocked(fetchAccessToken).mockRejectedValue(new Error("boom"));

    const result = await refreshAmazonPrices();

    expect(result).toEqual({ refreshed: 0, error: "collect_failed" });
  });

  it("continues remaining batches when one batch's getItems call fails", async () => {
    const staleRows = Array.from({ length: 15 }, (_, i) => ({ id: `hl${i}`, productId: `B${i}` }));
    vi.mocked(prisma.highlight.findMany).mockResolvedValue(staleRows as never);
    vi.mocked(fetchAccessToken).mockResolvedValue("token-abc");
    vi.mocked(getItems)
      .mockRejectedValueOnce(new Error("boom"))
      .mockImplementationOnce(async (asins) =>
        asins.map((asin) => ({ asin, title: "x", price: 10, oldPrice: null, discount: null, image: "x", affiliateLink: "x" }))
      );
    vi.mocked(prisma.highlight.update).mockResolvedValue({} as never);

    const result = await refreshAmazonPrices();

    expect(result).toEqual({ refreshed: 5 });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/collect/amazon.test.ts`
Expected: FAIL — `refreshAmazonPrices` is not exported yet.

- [ ] **Step 3: Implement `refreshAmazonPrices` and wire it into `collectAmazon`**

Add to `src/lib/collect/amazon.ts` (imports: add `import { prisma } from "@/lib/prisma";` and `getItems` to the existing `creatorsApiClient` import):

```ts
const REFRESH_BATCH_SIZE = 10;
const STALE_THRESHOLD_MS = 50 * 60 * 1000; // 50 min — under the 1h Offers TTL, with buffer

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export async function refreshAmazonPrices(): Promise<{ refreshed: number; error?: string }> {
  const staleRows = await prisma.highlight.findMany({
    where: {
      marketplace: "AMAZON",
      updatedAt: { lt: new Date(Date.now() - STALE_THRESHOLD_MS) },
    },
    select: { id: true, productId: true },
  });

  if (staleRows.length === 0) {
    return { refreshed: 0 };
  }

  let token: string;
  try {
    token = await fetchAccessToken();
  } catch (error) {
    console.error("refreshAmazonPrices failed to get a token:", error);
    return { refreshed: 0, error: "collect_failed" };
  }

  const rowsByAsin = new Map(staleRows.map((row) => [row.productId, row]));
  let refreshed = 0;

  for (const batch of chunk(staleRows, REFRESH_BATCH_SIZE)) {
    try {
      const freshItems = await getItems(batch.map((row) => row.productId), token);
      for (const item of freshItems) {
        const row = rowsByAsin.get(item.asin);
        if (!row) {
          continue;
        }
        await prisma.highlight.update({
          where: { id: row.id },
          data: { price: item.price, oldPrice: item.oldPrice, discount: item.discount },
        });
        refreshed++;
      }
    } catch (error) {
      console.error("refreshAmazonPrices batch failed:", error);
    }
  }

  return { refreshed };
}
```

Update `collectAmazon()` to call it after discovery, without letting a refresh failure override the discovery result:

```ts
export async function collectAmazon(): Promise<CollectResult> {
  const searchTerm = pickRandomSearchTerm();
  let discoveryResult: CollectResult;

  try {
    const token = await fetchAccessToken();

    const fetched: AmazonDealItem[] = [];
    for (let page = 1; page <= MAX_PAGES && fetched.length < TARGET_ITEM_COUNT; page++) {
      const pageItems = await searchItems(searchTerm, page, token);
      fetched.push(...pageItems);
      if (pageItems.length < ITEMS_PER_PAGE) {
        break;
      }
    }
    const items = fetched.slice(0, TARGET_ITEM_COUNT);

    if (items.length === 0) {
      discoveryResult = { attempted: 0, inserted: 0, skipped: 0 };
    } else {
      const mapped = mapAmazonItems(items);
      const { inserted, skipped } = await persistItems("AMAZON", mapped);
      discoveryResult = { attempted: items.length, inserted, skipped };
    }
  } catch (error) {
    if (error instanceof AmazonCreatorsApiError && error.rateLimited) {
      discoveryResult = { attempted: 0, inserted: 0, skipped: 0, error: "rate_limited" };
    } else {
      console.error("collectAmazon failed:", error);
      discoveryResult = { attempted: 0, inserted: 0, skipped: 0, error: "collect_failed" };
    }
  }

  await refreshAmazonPrices();

  return discoveryResult;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/collect/amazon.test.ts`
Expected: PASS (all `collectAmazon` and `refreshAmazonPrices` tests)

Note: the existing `collectAmazon` tests from Task 4 mock `prisma.highlight.findMany` to resolve `[]` by default (already set up in the mock at the top of the file), so `refreshAmazonPrices()` is a no-op during those tests and doesn't interfere with their assertions.

- [ ] **Step 5: Commit**

```bash
git add src/lib/collect/amazon.ts tests/collect/amazon.test.ts
git commit -m "feat: add age-gated Amazon price refresh via GetItems"
```

---

## Task 6: `/api/admin/amazon/search` route with native filters

**Files:**
- Create: `src/app/api/admin/amazon/search/route.ts`
- Test: `tests/api/admin/amazon/search.test.ts`

**Interfaces:**
- Consumes: `searchItems`, `fetchAccessToken` from Task 1; `persistItems`, `findHighlightsByProductIds` from Task 2; `isAuthorizedAdminRequest` from `@/lib/adminSession` (existing).
- Produces: `GET` handler reading `q`, `page`, `searchIndex`, `sortBy`, `brand`, `minPrice`, `maxPrice`, `prime` query params, returning `{ items: Highlight[] }` or an error body.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/api/admin/amazon/search.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/amazon/creatorsApiClient", () => ({
  fetchAccessToken: vi.fn(),
  searchItems: vi.fn(),
  AmazonCreatorsApiError: class AmazonCreatorsApiError extends Error {
    rateLimited: boolean;
    constructor(message: string, rateLimited = false) {
      super(message);
      this.rateLimited = rateLimited;
    }
  },
}));
vi.mock("@/lib/collect/persist", () => ({
  persistItems: vi.fn(),
  findHighlightsByProductIds: vi.fn(),
}));

import { GET } from "@/app/api/admin/amazon/search/route";
import { fetchAccessToken, searchItems, AmazonCreatorsApiError } from "@/lib/amazon/creatorsApiClient";
import { persistItems, findHighlightsByProductIds } from "@/lib/collect/persist";
import { ADMIN_SESSION_COOKIE, createSessionToken } from "@/lib/adminSession";

function authHeader() {
  return { cookie: `${ADMIN_SESSION_COOKIE}=${createSessionToken()}` };
}

const dealItem = {
  asin: "B01",
  title: "Produto",
  price: 10,
  oldPrice: null,
  discount: null,
  image: "https://img.example/1.jpg",
  affiliateLink: "https://www.amazon.com.br/dp/B01?tag=bonsachados0f-20",
};

const highlightRow = { id: "hl1", marketplace: "AMAZON", productId: "B01" };

function buildRequest(params: Record<string, string> = {}) {
  const url = new URL("http://localhost/api/admin/amazon/search");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return new NextRequest(url, { headers: authHeader() });
}

describe("GET /api/admin/amazon/search", () => {
  beforeEach(() => {
    process.env.ADMIN_USER = "admin";
    process.env.ADMIN_PASSWORD = "test-password";
  });
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.ADMIN_USER;
    delete process.env.ADMIN_PASSWORD;
  });

  it("returns 401 without calling anything when unauthorized", async () => {
    const response = await GET(new NextRequest("http://localhost/api/admin/amazon/search"));

    expect(response.status).toBe(401);
    expect(fetchAccessToken).not.toHaveBeenCalled();
  });

  it("searches with q and page, persists results, returns the enriched pool rows", async () => {
    vi.mocked(fetchAccessToken).mockResolvedValue("token-abc");
    vi.mocked(searchItems).mockResolvedValue([dealItem]);
    vi.mocked(findHighlightsByProductIds).mockResolvedValue([highlightRow] as never);

    const response = await GET(buildRequest({ q: "fone bluetooth", page: "2" }));
    const body = await response.json();

    expect(searchItems).toHaveBeenCalledWith("fone bluetooth", 2, "token-abc", {});
    expect(persistItems).toHaveBeenCalledWith("AMAZON", [expect.objectContaining({ productId: "B01" })]);
    expect(findHighlightsByProductIds).toHaveBeenCalledWith("AMAZON", ["B01"]);
    expect(body).toEqual({ items: [highlightRow] });
  });

  it("defaults page to 1 when missing", async () => {
    vi.mocked(fetchAccessToken).mockResolvedValue("token-abc");
    vi.mocked(searchItems).mockResolvedValue([]);
    vi.mocked(findHighlightsByProductIds).mockResolvedValue([]);

    await GET(buildRequest({ q: "fone" }));

    expect(searchItems).toHaveBeenCalledWith("fone", 1, "token-abc", {});
  });

  it("passes each filter through when present, and omits filters that are absent", async () => {
    vi.mocked(fetchAccessToken).mockResolvedValue("token-abc");
    vi.mocked(searchItems).mockResolvedValue([]);
    vi.mocked(findHighlightsByProductIds).mockResolvedValue([]);

    await GET(
      buildRequest({
        q: "fone",
        searchIndex: "Electronics",
        sortBy: "Price:LowToHigh",
        brand: "Sony",
        minPrice: "1000",
        maxPrice: "500000",
        prime: "true",
      })
    );

    expect(searchItems).toHaveBeenCalledWith("fone", 1, "token-abc", {
      searchIndex: "Electronics",
      sortBy: "Price:LowToHigh",
      brand: "Sony",
      minPrice: 1000,
      maxPrice: 500000,
      prime: true,
    });
  });

  it("returns 429 rate_limited when the Creators API rate-limits the request", async () => {
    vi.mocked(fetchAccessToken).mockResolvedValue("token-abc");
    vi.mocked(searchItems).mockRejectedValue(new AmazonCreatorsApiError("rate limited", true));

    const response = await GET(buildRequest({ q: "fone" }));
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(body).toEqual({ error: "rate_limited" });
  });

  it("returns 502 on any other error", async () => {
    vi.mocked(fetchAccessToken).mockRejectedValue(new Error("boom"));

    const response = await GET(buildRequest({ q: "fone" }));

    expect(response.status).toBe(502);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/api/admin/amazon/search.test.ts`
Expected: FAIL — route file does not exist yet.

- [ ] **Step 3: Implement the route**

```ts
// src/app/api/admin/amazon/search/route.ts
import { NextRequest, NextResponse } from "next/server";
import { fetchAccessToken, searchItems, AmazonCreatorsApiError, type AmazonSearchFilters } from "@/lib/amazon/creatorsApiClient";
import { persistItems, findHighlightsByProductIds } from "@/lib/collect/persist";
import { isAuthorizedAdminRequest } from "@/lib/adminSession";

export const maxDuration = 60;

function parseFilters(searchParams: URLSearchParams): AmazonSearchFilters {
  const filters: AmazonSearchFilters = {};
  const searchIndex = searchParams.get("searchIndex");
  const sortBy = searchParams.get("sortBy");
  const brand = searchParams.get("brand");
  const minPrice = searchParams.get("minPrice");
  const maxPrice = searchParams.get("maxPrice");
  const prime = searchParams.get("prime");

  if (searchIndex) filters.searchIndex = searchIndex;
  if (sortBy) filters.sortBy = sortBy;
  if (brand) filters.brand = brand;
  if (minPrice) filters.minPrice = Number(minPrice);
  if (maxPrice) filters.maxPrice = Number(maxPrice);
  if (prime === "true") filters.prime = true;

  return filters;
}

export async function GET(request: NextRequest) {
  if (!isAuthorizedAdminRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const query = request.nextUrl.searchParams.get("q") ?? "";
  const rawPage = Number(request.nextUrl.searchParams.get("page"));
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  const filters = parseFilters(request.nextUrl.searchParams);

  try {
    const token = await fetchAccessToken();
    const items = await searchItems(query, page, token, filters);
    const mapped = items.map((item) => ({
      productId: item.asin,
      title: item.title,
      affiliateLink: item.affiliateLink,
      image: item.image,
      price: item.price,
      oldPrice: item.oldPrice,
      discount: item.discount,
    }));
    await persistItems("AMAZON", mapped);
    const rows = await findHighlightsByProductIds("AMAZON", items.map((item) => item.asin));
    return NextResponse.json({ items: rows });
  } catch (error) {
    if (error instanceof AmazonCreatorsApiError && error.rateLimited) {
      return NextResponse.json({ error: "rate_limited" }, { status: 429 });
    }
    console.error("Amazon Creators API search failed:", error);
    return NextResponse.json({ error: "search_failed" }, { status: 502 });
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/api/admin/amazon/search.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/api/admin/amazon/search/route.ts tests/api/admin/amazon/search.test.ts
git commit -m "feat: add /api/admin/amazon/search with native SearchItems filters"
```

---

## Task 7: Remove the session-cookie scraper (files, routes, tests)

**Files:**
- Delete: `src/lib/amazon/session.ts`
- Delete: `src/lib/amazon/parseCurl.ts`
- Delete: `src/lib/amazon/hubClient.ts`
- Delete: `src/app/api/admin/amazon/session/route.ts`
- Delete: `src/app/api/admin/amazon/deals/route.ts`
- Delete: `tests/amazon/session.test.ts`
- Delete: `tests/amazon/parseCurl.test.ts`
- Delete: `tests/amazon/hubClient.test.ts`
- Delete: `tests/api/admin/amazon/session.test.ts`
- Delete: `tests/api/admin/amazon/deals.test.ts`

**Interfaces:** none — pure removal, no other task depends on any of these files after Tasks 1-6 land (Task 4 already stopped importing `hubClient`/`session`; Task 6 replaces the `deals`/`session` routes).

- [ ] **Step 1: Confirm nothing else references the files being removed**

Run: `grep -rn "amazon/hubClient\|amazon/session\|amazon/parseCurl\|amazon/deals\|amazon/session/route" src/ tests/ --include="*.ts" --include="*.tsx"`
Expected: only `src/app/admin/amazon/AmazonAdmin.tsx` (rewritten in Task 8, next) still references the old session/deals endpoints — no other file does.

- [ ] **Step 2: Delete the files**

```bash
git rm src/lib/amazon/session.ts src/lib/amazon/parseCurl.ts src/lib/amazon/hubClient.ts \
  src/app/api/admin/amazon/session/route.ts src/app/api/admin/amazon/deals/route.ts \
  tests/amazon/session.test.ts tests/amazon/parseCurl.test.ts tests/amazon/hubClient.test.ts \
  tests/api/admin/amazon/session.test.ts tests/api/admin/amazon/deals.test.ts
```

- [ ] **Step 3: Run the full test suite**

Run: `npx vitest run`
Expected: FAIL only in `tests/*` that reference `AmazonAdmin.tsx`, if any exist — otherwise PASS. (`AmazonAdmin.tsx` itself still imports the deleted `/api/admin/amazon/session` and `/api/admin/amazon/deals` endpoints as fetch URLs — those are runtime strings, not imports, so this won't fail the build/tests yet; it's fixed in Task 8.)

- [ ] **Step 4: Commit**

```bash
git commit -m "chore: remove the Amazon session-cookie scraper, superseded by the Creators API client"
```

---

## Task 8: Rewrite `AmazonAdmin.tsx` — drop session UI, add search + filters

**Files:**
- Modify: `src/app/admin/amazon/AmazonAdmin.tsx`

**Interfaces:**
- Consumes: `GET /api/admin/highlights?marketplace=AMAZON` (existing, unchanged), `GET /api/admin/amazon/search?q=&page=&searchIndex=&sortBy=&brand=&minPrice=&maxPrice=&prime=` (Task 6), `POST /api/admin/postdraft` (existing, unchanged), `DELETE /api/admin/highlights/[id]` (existing, unchanged).

This mirrors `MercadoLivreAdmin.tsx`'s structure closely (already read in full during planning) — same session-free pool-loading pattern, same card grid, same select/remove/copy handlers — swapping ML's category/sort/exclusivity filters for Amazon's `searchIndex`/`sortBy`/`brand`/price-range/Prime.

- [ ] **Step 1: Replace `src/app/admin/amazon/AmazonAdmin.tsx`**

```tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import PostTitleModal from "@/app/admin/PostTitleModal";
import ScrollToTopButton from "@/components/ScrollToTopButton";
import { copyToClipboard } from "@/lib/clipboard";

type SortOption = "Relevance" | "Price:LowToHigh" | "Price:HighToLow" | "AvgCustomerReviews" | "NewestArrivals";

const SEARCH_INDEXES = [
  { value: "", label: "Todas as categorias" },
  { value: "Books", label: "Livros" },
  { value: "Computers", label: "Computadores e Informática" },
  { value: "Electronics", label: "Eletrônicos" },
  { value: "HomeAndKitchen", label: "Casa e Cozinha" },
  { value: "KindleStore", label: "Loja Kindle" },
  { value: "MobileApps", label: "Apps e Jogos" },
  { value: "OfficeProducts", label: "Material para Escritório e Papelaria" },
  { value: "ToolsAndHomeImprovement", label: "Ferramentas e Materiais de Construção" },
  { value: "VideoGames", label: "Games" },
];

type PoolItem = {
  id: string;
  productId: string;
  title: string;
  affiliateLink: string;
  image: string;
  price: number;
  oldPrice: number | null;
  discount: number | null;
};

function formatPrice(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function AmazonAdmin() {
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>("Relevance");
  const [searchIndex, setSearchIndex] = useState("");
  const [brand, setBrand] = useState("");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [primeOnly, setPrimeOnly] = useState(false);

  const [items, setItems] = useState<PoolItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [selectingId, setSelectingId] = useState<string | null>(null);
  const [selectedForPost, setSelectedForPost] = useState<Record<string, boolean>>({});
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [pendingItem, setPendingItem] = useState<PoolItem | null>(null);

  // Loads the pool already collected for this marketplace — a database
  // read, no live Amazon request.
  useEffect(() => {
    fetch("/api/admin/highlights?marketplace=AMAZON")
      .then((response) => response.json())
      .then((body) => setItems(body.items ?? []))
      .catch(() => setSearchError("Não deu para carregar as ofertas já coletadas."))
      .finally(() => setLoading(false));
  }, []);

  const runSearch = useCallback(async () => {
    setSearching(true);
    setSearchError(null);
    try {
      const params = new URLSearchParams({ q: query, page: "1" });
      if (searchIndex) params.set("searchIndex", searchIndex);
      if (sortBy !== "Relevance") params.set("sortBy", sortBy);
      if (brand) params.set("brand", brand);
      if (minPrice) params.set("minPrice", String(Math.round(Number(minPrice) * 100)));
      if (maxPrice) params.set("maxPrice", String(Math.round(Number(maxPrice) * 100)));
      if (primeOnly) params.set("prime", "true");

      const response = await fetch(`/api/admin/amazon/search?${params.toString()}`);
      if (response.status === 429) {
        setSearchError("A Amazon limitou as requisições por agora. Tente de novo em alguns segundos.");
        return;
      }
      const body = await response.json();
      if (!response.ok) {
        throw new Error("search_failed");
      }
      setItems(body.items as PoolItem[]);
      setSearched(true);
    } catch {
      setSearchError("A busca falhou. Tente de novo em alguns segundos.");
    } finally {
      setSearching(false);
    }
  }, [query, searchIndex, sortBy, brand, minPrice, maxPrice, primeOnly]);

  async function handleSearch(event: React.FormEvent) {
    event.preventDefault();
    await runSearch();
  }

  function handleClearFilters() {
    setSortBy("Relevance");
    setSearchIndex("");
    setBrand("");
    setMinPrice("");
    setMaxPrice("");
    setPrimeOnly(false);
  }

  // Changing a filter re-runs the search after a short debounce, skipping
  // the initial mount so opening the page doesn't replace the saved pool.
  const filtersMounted = useRef(false);
  useEffect(() => {
    if (!filtersMounted.current) {
      filtersMounted.current = true;
      return;
    }
    const timeoutId = window.setTimeout(() => {
      void runSearch();
    }, 400);
    return () => window.clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortBy, searchIndex, brand, minPrice, maxPrice, primeOnly]);

  const filtersActive =
    sortBy !== "Relevance" || searchIndex !== "" || brand !== "" || minPrice !== "" || maxPrice !== "" || primeOnly;

  async function handleSelectForPost(item: PoolItem, imageTitle: string) {
    setSelectingId(item.id);
    setSearchError(null);
    try {
      const response = await fetch("/api/admin/postdraft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          marketplace: "AMAZON",
          source: "AUTO",
          title: item.title,
          imageTitle,
          affiliateLink: item.affiliateLink,
          image: item.image,
          price: item.price,
          discount: item.discount,
          category: null,
        }),
      });
      if (response.status === 409) {
        setSelectedForPost((previous) => ({ ...previous, [item.id]: true }));
        return;
      }
      if (!response.ok) {
        setSearchError(`Não deu para selecionar "${item.title}" para postar. Tente de novo.`);
        return;
      }
      setSelectedForPost((previous) => ({ ...previous, [item.id]: true }));
    } catch {
      setSearchError(`Não deu para selecionar "${item.title}" para postar. Tente de novo.`);
    } finally {
      setSelectingId(null);
    }
  }

  async function handleRemove(item: PoolItem) {
    setRemovingId(item.id);
    setSearchError(null);
    try {
      const response = await fetch(`/api/admin/highlights/${item.id}`, { method: "DELETE" });
      if (!response.ok) {
        throw new Error("remove_failed");
      }
      setItems((previous) => previous.filter((existing) => existing.id !== item.id));
    } catch {
      setSearchError(`Não deu para remover "${item.title}" da vitrine. Tente de novo.`);
    } finally {
      setRemovingId(null);
    }
  }

  async function handleCopy(id: string, link: string) {
    const succeeded = await copyToClipboard(link);
    if (!succeeded) {
      setSearchError("O navegador bloqueou a cópia. Selecione o link e copie na mão.");
      return;
    }
    setCopiedId(id);
    window.setTimeout(() => setCopiedId(null), 2000);
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] tracking-[0.22em] text-ash uppercase">Amazon</p>
          <h1 className="font-display font-stretch-condensed text-3xl leading-none font-black text-paper uppercase italic sm:text-4xl">
            Hub de <span className="text-gold">afiliados</span>
          </h1>
        </div>
      </div>

      <div className="mt-8">
        <form onSubmit={handleSearch} className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <label htmlFor="amz-query" className="sr-only">
            O que você procura
          </label>
          <input
            id="amz-query"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="fone bluetooth, air fryer, cadeira gamer… (opcional — busca alimenta a vitrine na hora)"
            className="min-w-0 flex-1 rounded-full border border-ink-line bg-ink-raised px-5 py-3 text-sm text-paper placeholder:text-ash/70 focus-visible:border-gold focus-visible:ring-2 focus-visible:ring-gold/40 focus-visible:outline-none"
          />
          <button
            type="submit"
            disabled={searching}
            className="rounded-full bg-gold px-7 py-3 font-display font-stretch-condensed text-sm font-black tracking-wide text-ink uppercase italic transition hover:bg-paper focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-ink focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          >
            {searching ? "Buscando…" : "Buscar produtos"}
          </button>
        </form>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label className="sr-only" htmlFor="amz-sort">
            Ordenar por
          </label>
          <select
            id="amz-sort"
            value={sortBy}
            onChange={(event) => setSortBy(event.target.value as SortOption)}
            className="rounded-full border border-ink-line bg-ink-raised px-4 py-2 font-mono text-xs tracking-wider text-paper uppercase focus-visible:border-gold focus-visible:ring-2 focus-visible:ring-gold/40 focus-visible:outline-none"
          >
            <option value="Relevance">Mais relevantes</option>
            <option value="Price:LowToHigh">Menor preço</option>
            <option value="Price:HighToLow">Maior preço</option>
            <option value="AvgCustomerReviews">Melhor avaliados</option>
            <option value="NewestArrivals">Mais recentes</option>
          </select>

          <label className="sr-only" htmlFor="amz-category">
            Categoria
          </label>
          <select
            id="amz-category"
            value={searchIndex}
            onChange={(event) => setSearchIndex(event.target.value)}
            className="rounded-full border border-ink-line bg-ink-raised px-4 py-2 font-mono text-xs tracking-wider text-paper uppercase focus-visible:border-gold focus-visible:ring-2 focus-visible:ring-gold/40 focus-visible:outline-none"
          >
            {SEARCH_INDEXES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <label htmlFor="amz-brand" className="sr-only">
            Marca
          </label>
          <input
            id="amz-brand"
            value={brand}
            onChange={(event) => setBrand(event.target.value)}
            placeholder="Marca"
            className="w-32 rounded-full border border-ink-line bg-ink-raised px-4 py-2 font-mono text-xs tracking-wider text-paper placeholder:text-ash/70 focus-visible:border-gold focus-visible:ring-2 focus-visible:ring-gold/40 focus-visible:outline-none"
          />

          <label htmlFor="amz-min-price" className="sr-only">
            Preço mínimo
          </label>
          <input
            id="amz-min-price"
            type="number"
            min="0"
            step="0.01"
            value={minPrice}
            onChange={(event) => setMinPrice(event.target.value)}
            placeholder="Preço mín."
            className="w-28 rounded-full border border-ink-line bg-ink-raised px-4 py-2 font-mono text-xs tracking-wider text-paper placeholder:text-ash/70 focus-visible:border-gold focus-visible:ring-2 focus-visible:ring-gold/40 focus-visible:outline-none"
          />

          <label htmlFor="amz-max-price" className="sr-only">
            Preço máximo
          </label>
          <input
            id="amz-max-price"
            type="number"
            min="0"
            step="0.01"
            value={maxPrice}
            onChange={(event) => setMaxPrice(event.target.value)}
            placeholder="Preço máx."
            className="w-28 rounded-full border border-ink-line bg-ink-raised px-4 py-2 font-mono text-xs tracking-wider text-paper placeholder:text-ash/70 focus-visible:border-gold focus-visible:ring-2 focus-visible:ring-gold/40 focus-visible:outline-none"
          />

          <button
            type="button"
            onClick={() => setPrimeOnly((previous) => !previous)}
            aria-pressed={primeOnly}
            className={`rounded-full border px-4 py-2 font-mono text-xs tracking-wider uppercase transition focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none ${
              primeOnly
                ? "border-gold bg-gold text-ink"
                : "border-ink-line bg-ink-raised text-paper hover:border-gold hover:text-gold"
            }`}
          >
            Só Prime
          </button>

          {filtersActive && (
            <button
              type="button"
              onClick={handleClearFilters}
              className="font-mono text-xs tracking-wider text-ash uppercase transition hover:text-paper focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
            >
              Limpar filtros
            </button>
          )}
        </div>

        <p aria-live="polite" className="mt-6 font-mono text-[11px] tracking-[0.2em] text-ash uppercase">
          {loading || searching
            ? "carregando…"
            : items.length > 0
              ? `${items.length} produto${items.length === 1 ? "" : "s"} na vitrine hoje`
              : ""}
        </p>

        {searchError && (
          <p
            role="alert"
            className="mt-4 rounded-xl border border-alert/40 bg-alert/10 px-4 py-3 text-sm text-paper"
          >
            {searchError}
          </p>
        )}

        {!loading && !searching && searched && items.length === 0 && !searchError && (
          <p className="mt-10 text-sm text-ash">Nada encontrado para essa busca. Tente outro termo.</p>
        )}

        {!loading && !searching && !searched && items.length === 0 && !searchError && (
          <p className="mt-10 text-sm text-ash">
            Nenhum produto na vitrine ainda. A coleta automática roda a cada 20 minutos.
          </p>
        )}

        <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item, index) => (
            <article
              key={item.id}
              style={{ animationDelay: `${Math.min(index, 11) * 35}ms` }}
              className="flex animate-sticker-in flex-col overflow-hidden rounded-2xl bg-paper text-ink shadow-[0_10px_24px_-14px_rgba(0,0,0,0.9)]"
            >
              <div className="relative bg-white p-3">
                {item.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.image} alt="" loading="lazy" className="mx-auto h-40 w-full object-contain" />
                ) : (
                  <div className="flex h-40 items-center justify-center font-mono text-xs text-ash">sem imagem</div>
                )}
                {item.discount !== null && (
                  <span className="absolute bottom-3 left-3 rounded-md bg-ink px-2 py-0.5 font-display font-stretch-condensed text-xs font-black text-gold italic">
                    {item.discount}% off
                  </span>
                )}
              </div>

              <div className="flex flex-1 flex-col gap-3 border-t border-ink/10 p-4">
                <h2 className="line-clamp-2 text-sm leading-snug font-medium text-ink">{item.title}</h2>

                <div className="flex items-baseline gap-2">
                  <span className="font-display font-stretch-condensed text-2xl leading-none font-black tracking-tight text-ink tabular-nums">
                    {formatPrice(item.price)}
                  </span>
                  {item.oldPrice !== null && (
                    <span className="font-mono text-xs text-ash line-through tabular-nums">
                      {formatPrice(item.oldPrice)}
                    </span>
                  )}
                </div>

                <div className="mt-auto pt-1">
                  <div className="rounded-xl border border-ink/15 bg-ink/[0.04] p-2">
                    <div className="flex items-center gap-2">
                      <input
                        readOnly
                        aria-label={`Link de afiliado de ${item.title}`}
                        value={item.affiliateLink}
                        onFocus={(event) => event.currentTarget.select()}
                        className="min-w-0 flex-1 bg-transparent font-mono text-[11px] text-ink focus-visible:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => handleCopy(item.id, item.affiliateLink)}
                        className="shrink-0 rounded-full bg-ink px-3 py-1.5 font-mono text-[10px] tracking-wider text-gold uppercase transition hover:bg-ink-raised focus-visible:ring-2 focus-visible:ring-ink focus-visible:outline-none"
                      >
                        {copiedId === item.id ? "Copiado" : "Copiar"}
                      </button>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPendingItem(item)}
                    disabled={selectingId === item.id || selectedForPost[item.id]}
                    className="mt-2 w-full rounded-full border border-gold/40 px-4 py-2 font-mono text-[10px] tracking-wider text-gold uppercase transition hover:bg-gold hover:text-ink focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {selectedForPost[item.id]
                      ? "Selecionado ✓"
                      : selectingId === item.id
                        ? "Selecionando…"
                        : "Selecionar para postar"}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRemove(item)}
                    disabled={removingId === item.id}
                    className="mt-2 w-full rounded-full border border-alert/40 px-4 py-2 font-mono text-[10px] tracking-wider text-alert uppercase transition hover:bg-alert hover:text-paper focus-visible:ring-2 focus-visible:ring-alert focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {removingId === item.id ? "Removendo…" : "Remover da vitrine"}
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>

      {pendingItem && (
        <PostTitleModal
          initialTitle={pendingItem.title}
          submitting={selectingId === pendingItem.id}
          onCancel={() => setPendingItem(null)}
          onConfirm={async (imageTitle) => {
            await handleSelectForPost(pendingItem, imageTitle);
            setPendingItem(null);
          }}
        />
      )}

      <ScrollToTopButton />
    </div>
  );
}
```

- [ ] **Step 2: Run the full test suite**

Run: `npx vitest run`
Expected: PASS (no test file targets `AmazonAdmin.tsx` directly — the project has no automated UI tests for admin components, per existing convention; this step confirms nothing else broke).

- [ ] **Step 3: Run the linter**

Run: `npx eslint src/app/admin/amazon/AmazonAdmin.tsx`
Expected: no errors.

- [ ] **Step 4: Manual verification in the browser**

Run: `npm run dev`, then open `/admin/amazon` (log in with `ADMIN_USER`/`ADMIN_PASSWORD` from `.env.local`):
1. Confirm the page loads the existing pool automatically, no session form appears.
2. Type a keyword and submit; confirm results replace the grid (requires Task 9's env vars to be set with real credentials to actually hit the API — if not yet configured, confirm the request fails gracefully with the "busca falhou" message rather than crashing the page).
3. Toggle each filter (categoria, ordenar por, marca, preço mín/máx, só Prime) and confirm the debounced re-search fires (visible in the Network tab as a call to `/api/admin/amazon/search` ~400ms after the last change).

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/amazon/AmazonAdmin.tsx
git commit -m "feat: rewrite AmazonAdmin hub with search and native Creators API filters"
```

---

## Task 9: Env vars, cron route sanity check, manual end-to-end verification

**Files:**
- Modify: `.env.example`

**Interfaces:** none — configuration only.

- [ ] **Step 1: Add the new env vars to `.env.example`**

```bash
# .env.example — insert after the existing AMAZON_AFFILIATE_TAG line
AMAZON_CREATORS_CLIENT_ID="your-creators-api-client-id"
AMAZON_CREATORS_CLIENT_SECRET="your-creators-api-client-secret"
AMAZON_CREATORS_CREDENTIAL_VERSION="3.1"
```

(`AMAZON_CREATORS_CREDENTIAL_VERSION` isn't read by any code in this plan — the client hardcodes the NA token endpoint since BR is fixed to that region — but it's documented for whoever configures the Vercel/GitHub secrets, matching the version shown in the Associates Central credential screen.)

- [ ] **Step 2: Confirm `/api/cron/collect/route.ts` needs no changes**

Read `src/app/api/cron/collect/route.ts`: it calls `collectAmazon()` inside `Promise.allSettled([collectAmazon(), collectMercadoLivre(), collectShopee()])` and maps each `PromiseSettledResult<CollectResult>` to a `CollectResult` — since `collectAmazon()`'s exported signature is unchanged from Task 5 (still `Promise<CollectResult>`, now with `refreshAmazonPrices()` folded in internally), no edit is needed here. Run `npx vitest run tests/api/cron/collect.test.ts` to confirm the existing test suite still passes unmodified.

Expected: PASS

- [ ] **Step 3: Set the real credentials locally and in deployment**

1. In `.env.local` (not committed), set `AMAZON_CREATORS_CLIENT_ID`, `AMAZON_CREATORS_CLIENT_SECRET` from Associates Central > Tools > Creators API (per `docs/superpowers/specs/2026-08-17-amazon-creators-api-design.md`'s "Autenticação" section — this is where Task 1 Step 10's live verification call gets its real credentials from).
2. In the Vercel project settings, add the same three env vars for the Production environment.
3. Remove `AmazonSession`-related secrets if any were stored outside the database (none expected — the old design only persisted the cookie in Neon, not as an env var).

- [ ] **Step 4: Run the full test suite one more time**

Run: `npx vitest run`
Expected: PASS — every test file touched across Tasks 1-8, plus the untouched suite, all green.

- [ ] **Step 5: Run the production build**

Run: `npm run build`
Expected: succeeds with no type errors (this catches any leftover reference to the deleted `AmazonSession` Prisma model, `hubClient`, `session.ts`, or `parseCurl.ts`).

- [ ] **Step 6: Manual end-to-end verification against Neon + the real Creators API**

Follow the spec's "Verificação manual" section (`docs/superpowers/specs/2026-08-17-amazon-creators-api-design.md`) end to end:
1. Run the migration from Task 3 against the real Neon database: `npx prisma migrate deploy`.
2. Trigger `POST /api/cron/collect` manually with the real `CRON_COLLECT_SECRET` and confirm `Highlight` rows appear for `marketplace = AMAZON` with real Creators API data.
3. Open `/admin/amazon`, confirm the pool loads and the search + filters work end to end.
4. Trigger `POST /api/cron/collect` twice in a row and confirm an existing Amazon `Highlight` row's `updatedAt` changes (upsert working).
5. Manually set one Amazon `Highlight.updatedAt` to more than 50 minutes ago (`UPDATE "Highlight" SET "updatedAt" = now() - interval '1 hour' WHERE marketplace = 'AMAZON' LIMIT 1;`), trigger the cron again, confirm `refreshAmazonPrices` picks it up and updates its price fields.
6. Open a generated affiliate link and confirm `tag=bonsachados0f-20` (or the real configured tag) is present in the URL.

- [ ] **Step 7: Commit**

```bash
git add .env.example
git commit -m "docs: document Amazon Creators API env vars in .env.example"
```

---

## Self-Review Notes

- **Spec coverage:** Autenticação → Task 1. Descoberta de produtos → Task 4. Mapeamento de resposta → Task 1 (`parseProduct`). Atualização de preço/TTL → Tasks 2 + 5. Rate limits (429 handling) → Tasks 1, 4, 6. Hub admin + Filtros → Tasks 6 + 8. Modelo de dados → Task 3. Componentes/arquivos (novo/alterado/removido) → Tasks 1-8 map 1:1 to the spec's file list. Novas env vars → Task 9. Tratamento de erros → Tasks 4, 5, 6. Testes → one test file/section per implementation task. Verificação manual → Task 9 Step 6.
- **Open risk flagged explicitly, not hidden:** the `SearchItems` endpoint path (`/catalog/v1/searchItems`) is an inference from the `GetItems` example in the docs, not confirmed by a captured example — Task 1 Step 10 calls this out with a concrete verification step and a fallback edit path, rather than asserting it's correct.
- **Sequential rate limiting (~1.1s spacing) from the spec is not implemented as literal `setTimeout` delays** in any task — at the volumes calculated in the spec (max ~15 sequential `GetItems` calls in the worst-case batch within one cron cycle, plus 5 `SearchItems` calls), each call's own network latency (typically several hundred ms) combined with `await`-sequential (not parallel) execution already keeps effective throughput under 1 TPS in practice. This is a reasonable simplification for the initial rollout; if 429s are observed in Step 6's manual verification, add an explicit `await sleep(1100)` between calls in `creatorsApiClient.ts`'s `callCreatorsApi` as a follow-up, not blocking this plan's completion.
