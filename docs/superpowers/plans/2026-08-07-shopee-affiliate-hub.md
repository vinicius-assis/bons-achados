# Shopee Affiliate Open API Hub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the unvalidated manual Shopee product entry with a search-based admin hub backed by the official Shopee Affiliate Open API (signed GraphQL), mirroring the Amazon/Mercado Livre hub pattern already in the app.

**Architecture:** A signed GraphQL client (`src/lib/shopee/client.ts`) wraps authentication; a hub client (`src/lib/shopee/hubClient.ts`) wraps the `productOfferV2` search query and maps results to a `ShopeeHubItem` shape the UI and `Highlight`/`PostDraft` creation already understand. An API route exposes search to the browser; a client component (`ShopeeAdmin.tsx`) reuses the existing search/highlight/postdraft UI pattern, minus any session UI (the Shopee API is stateless — AppId/Secret from env, no cookies). The dead manual-entry form is deleted.

**Tech Stack:** Next.js (App Router), TypeScript, Node `crypto`, Vitest, Tailwind CSS, Prisma.

## Global Constraints

- Endpoint: `https://open-api.affiliate.shopee.com.br/graphql`, `POST`, `content-type: application/json`.
- Auth header format: `SHA256 Credential=${AppId}, Timestamp=${Timestamp}, Signature=${signature}` where `signature = SHA256(AppId + Timestamp + Payload + Secret)`, hex-encoded, lowercase. `Payload` is the exact JSON string sent as the request body.
- Env vars: `SHOPEE_APP_ID`, `SHOPEE_APP_SECRET` — both required; missing either throws before any network call.
- Request timeout: `AbortSignal.timeout(10_000)` (matches Amazon/ML hubs).
- `productOfferV2` search: `sortType: 1` (`RELEVANCE_DESC`) is the only sort used; `limit: 20` per page.
- `Highlight.oldPrice` is always `null` for Shopee items — the API does not return an explicit original price.
- `Highlight.discount` comes from `priceDiscountRate` (already a plain number, e.g. `10` for 10%).
- The hub replaces manual Shopee entry entirely — `/admin/produtos/novo` is deleted, not left empty.

---

### Task 1: Signed Shopee API client

**Files:**
- Create: `src/lib/shopee/client.ts`
- Test: `tests/shopee/client.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces: `shopeeRequest<T>(query: string, variables?: Record<string, unknown>): Promise<T>` — exported from `src/lib/shopee/client.ts`. Resolves to the `data` field of a successful GraphQL response, typed as `T`.
- Produces: `class ShopeeApiError extends Error` — exported from `src/lib/shopee/client.ts`, with an optional `code?: number` property (the GraphQL error's `extensions.code`, when present).

- [ ] **Step 1: Write the failing tests**

Create `tests/shopee/client.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/shopee/client.test.ts`
Expected: FAIL — `Cannot find module '@/lib/shopee/client'` (the module doesn't exist yet).

- [ ] **Step 3: Implement the client**

Create `src/lib/shopee/client.ts`:

```ts
import { createHash } from "crypto";

const GRAPHQL_ENDPOINT = "https://open-api.affiliate.shopee.com.br/graphql";

export class ShopeeApiError extends Error {
  code?: number;

  constructor(message: string, code?: number) {
    super(message);
    this.name = "ShopeeApiError";
    this.code = code;
  }
}

type GraphQLErrorBody = {
  message: string;
  path?: string;
  extensions?: { code?: number; message?: string };
};

function signPayload(appId: string, timestamp: number, payload: string, secret: string): string {
  return createHash("sha256").update(`${appId}${timestamp}${payload}${secret}`).digest("hex");
}

export async function shopeeRequest<T>(
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const appId = process.env.SHOPEE_APP_ID;
  if (!appId) {
    throw new Error("SHOPEE_APP_ID is not set");
  }
  const secret = process.env.SHOPEE_APP_SECRET;
  if (!secret) {
    throw new Error("SHOPEE_APP_SECRET is not set");
  }

  const payload = JSON.stringify({ query, variables });
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = signPayload(appId, timestamp, payload, secret);

  const response = await fetch(GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `SHA256 Credential=${appId}, Timestamp=${timestamp}, Signature=${signature}`,
    },
    body: payload,
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new ShopeeApiError(`Shopee API request failed: ${response.status}`);
  }

  const body = (await response.json()) as { data?: T; errors?: GraphQLErrorBody[] };
  if (body.errors && body.errors.length > 0) {
    const [firstError] = body.errors;
    throw new ShopeeApiError(firstError.message, firstError.extensions?.code);
  }

  return body.data as T;
}
```

Note: `JSON.stringify({ query, variables })` drops the `variables` key entirely when `variables` is `undefined` — this is what makes the golden-example test's body match the documentation's payload exactly (the doc's example has no `variables` key).

Note: the expected signature `43a5dabcfb6598dfcaefc377088988228ddc512202fee19d2ceca1909cba60c6` was independently verified with `sha256sum` against the exact factor string `123456` + `1577836800` + payload + `demo` — it does not match the value printed on Shopee's documentation page (`dc88d72feea70c80c52c3399751a7d34966763f51a7f056aa070a5e9df645412`), which appears to be a stale/incorrect example in their docs. The signing *algorithm* (`SHA256(AppId+Timestamp+Payload+Secret)`, hex lowercase) is unambiguous prose and not in question — only the doc's one printed example output is wrong.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/shopee/client.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Document the env vars**

Add to `.env.example`, after the `AMAZON_AFFILIATE_TAG` line:

```
SHOPEE_APP_ID="your-shopee-app-id"
SHOPEE_APP_SECRET="your-shopee-app-secret"
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/shopee/client.ts tests/shopee/client.test.ts .env.example
git commit -m "feat: add signed Shopee Affiliate Open API client"
```

---

### Task 2: Product search hub client

**Files:**
- Create: `src/lib/shopee/hubClient.ts`
- Test: `tests/shopee/hubClient.test.ts`

**Interfaces:**
- Consumes: `shopeeRequest<T>(query: string, variables?: Record<string, unknown>): Promise<T>` and `ShopeeApiError` from `@/lib/shopee/client` (Task 1).
- Produces: `type ShopeeHubItem = { itemId: string; title: string; price: number; discount: number | null; image: string; affiliateLink: string; productLink: string; shopName: string; commissionRate: string | null; ratingStar: number | null }` — exported from `src/lib/shopee/hubClient.ts`.
- Produces: `searchProducts(keyword: string, page: number): Promise<{ items: ShopeeHubItem[]; hasNextPage: boolean }>` — exported from `src/lib/shopee/hubClient.ts`.

- [ ] **Step 1: Write the failing tests**

Create `tests/shopee/hubClient.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/shopee/client", async () => {
  const actual = await vi.importActual("@/lib/shopee/client");
  return { ...actual, shopeeRequest: vi.fn() };
});

import { searchProducts } from "@/lib/shopee/hubClient";
import { shopeeRequest } from "@/lib/shopee/client";

const RAW_NODE = {
  itemId: 17979995178,
  commissionRate: "0.25",
  priceMin: "45.99",
  priceMax: "55.99",
  priceDiscountRate: 10,
  imageUrl: "https://cf.shopee.com.br/file/abc123",
  offerLink: "https://shope.ee/xxxxxxxx",
  productLink: "https://shopee.com.br/product/14318452/4058376611",
  productName: "IKEA starfish",
  shopName: "IKEA",
  ratingStar: "4.7",
};

describe("searchProducts", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns an empty result without calling shopeeRequest when keyword is blank", async () => {
    const result = await searchProducts("", 1);

    expect(result).toEqual({ items: [], hasNextPage: false });
    expect(shopeeRequest).not.toHaveBeenCalled();
  });

  it("returns an empty result when keyword is only whitespace", async () => {
    const result = await searchProducts("   ", 1);

    expect(result).toEqual({ items: [], hasNextPage: false });
    expect(shopeeRequest).not.toHaveBeenCalled();
  });

  it("sends keyword and page as GraphQL variables", async () => {
    vi.mocked(shopeeRequest).mockResolvedValue({
      productOfferV2: { nodes: [], pageInfo: { hasNextPage: false } },
    });

    await searchProducts("fone bluetooth", 2);

    expect(shopeeRequest).toHaveBeenCalledWith(
      expect.stringContaining("productOfferV2"),
      { keyword: "fone bluetooth", page: 2 }
    );
  });

  it("maps a raw node to a ShopeeHubItem", async () => {
    vi.mocked(shopeeRequest).mockResolvedValue({
      productOfferV2: { nodes: [RAW_NODE], pageInfo: { hasNextPage: true } },
    });

    const { items, hasNextPage } = await searchProducts("starfish", 1);

    expect(hasNextPage).toBe(true);
    expect(items).toEqual([
      {
        itemId: "17979995178",
        title: "IKEA starfish",
        price: 45.99,
        discount: 10,
        image: "https://cf.shopee.com.br/file/abc123",
        affiliateLink: "https://shope.ee/xxxxxxxx",
        productLink: "https://shopee.com.br/product/14318452/4058376611",
        shopName: "IKEA",
        commissionRate: "0.25",
        ratingStar: 4.7,
      },
    ]);
  });

  it("maps priceDiscountRate 0 to discount null", async () => {
    vi.mocked(shopeeRequest).mockResolvedValue({
      productOfferV2: {
        nodes: [{ ...RAW_NODE, priceDiscountRate: 0 }],
        pageInfo: { hasNextPage: false },
      },
    });

    const { items } = await searchProducts("starfish", 1);

    expect(items[0].discount).toBeNull();
  });

  it("drops a node with a non-numeric priceMin and keeps the valid ones", async () => {
    const broken = { ...RAW_NODE, itemId: 999, priceMin: "not-a-number" };
    vi.mocked(shopeeRequest).mockResolvedValue({
      productOfferV2: { nodes: [RAW_NODE, broken], pageInfo: { hasNextPage: false } },
    });

    const { items } = await searchProducts("starfish", 1);

    expect(items).toHaveLength(1);
    expect(items[0].itemId).toBe("17979995178");
  });

  it("drops a node missing productName", async () => {
    const broken = { ...RAW_NODE, itemId: 999, productName: undefined };
    vi.mocked(shopeeRequest).mockResolvedValue({
      productOfferV2: { nodes: [broken], pageInfo: { hasNextPage: false } },
    });

    const { items } = await searchProducts("starfish", 1);

    expect(items).toEqual([]);
  });

  it("propagates a ShopeeApiError thrown by shopeeRequest", async () => {
    const { ShopeeApiError } = await vi.importActual<typeof import("@/lib/shopee/client")>(
      "@/lib/shopee/client"
    );
    vi.mocked(shopeeRequest).mockRejectedValue(new ShopeeApiError("boom", 10030));

    await expect(searchProducts("starfish", 1)).rejects.toThrow("boom");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/shopee/hubClient.test.ts`
Expected: FAIL — `Cannot find module '@/lib/shopee/hubClient'`.

- [ ] **Step 3: Implement the hub client**

Create `src/lib/shopee/hubClient.ts`:

```ts
import { shopeeRequest } from "@/lib/shopee/client";

const SEARCH_QUERY = `
  query SearchOffers($keyword: String!, $page: Int!) {
    productOfferV2(keyword: $keyword, sortType: 1, page: $page, limit: 20) {
      nodes {
        itemId
        commissionRate
        priceMin
        priceDiscountRate
        imageUrl
        offerLink
        productLink
        productName
        shopName
        ratingStar
      }
      pageInfo {
        hasNextPage
      }
    }
  }
`;

export type ShopeeHubItem = {
  itemId: string;
  title: string;
  price: number;
  discount: number | null;
  image: string;
  affiliateLink: string;
  productLink: string;
  shopName: string;
  commissionRate: string | null;
  ratingStar: number | null;
};

type RawNode = {
  itemId?: number | string;
  commissionRate?: string;
  priceMin?: string;
  priceDiscountRate?: number;
  imageUrl?: string;
  offerLink?: string;
  productLink?: string;
  productName?: string;
  shopName?: string;
  ratingStar?: string;
};

type SearchResponse = {
  productOfferV2: {
    nodes: RawNode[];
    pageInfo: { hasNextPage: boolean };
  };
};

function parseNode(node: RawNode): ShopeeHubItem | null {
  try {
    if (!node.itemId || !node.productName || !node.offerLink) {
      return null;
    }
    const price = Number(node.priceMin);
    if (Number.isNaN(price)) {
      return null;
    }
    const discount = node.priceDiscountRate && node.priceDiscountRate > 0 ? node.priceDiscountRate : null;
    const ratingStar = node.ratingStar !== undefined ? parseFloat(node.ratingStar) : null;

    return {
      itemId: String(node.itemId),
      title: node.productName,
      price,
      discount,
      image: node.imageUrl ?? "",
      affiliateLink: node.offerLink,
      productLink: node.productLink ?? "",
      shopName: node.shopName ?? "",
      commissionRate: node.commissionRate ?? null,
      ratingStar: ratingStar !== null && !Number.isNaN(ratingStar) ? ratingStar : null,
    };
  } catch {
    return null;
  }
}

export async function searchProducts(
  keyword: string,
  page: number
): Promise<{ items: ShopeeHubItem[]; hasNextPage: boolean }> {
  const trimmedKeyword = keyword.trim();
  if (!trimmedKeyword) {
    return { items: [], hasNextPage: false };
  }

  const response = await shopeeRequest<SearchResponse>(SEARCH_QUERY, {
    keyword: trimmedKeyword,
    page,
  });

  const items = response.productOfferV2.nodes
    .map(parseNode)
    .filter((item): item is ShopeeHubItem => item !== null);

  return { items, hasNextPage: response.productOfferV2.pageInfo.hasNextPage };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/shopee/hubClient.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/shopee/hubClient.ts tests/shopee/hubClient.test.ts
git commit -m "feat: add Shopee product search mapped to ShopeeHubItem"
```

---

### Task 3: Search API route

**Files:**
- Create: `src/app/api/admin/shopee/search/route.ts`
- Test: `tests/api/admin/shopee/search.test.ts`

**Interfaces:**
- Consumes: `searchProducts(keyword: string, page: number): Promise<{ items: ShopeeHubItem[]; hasNextPage: boolean }>` and `ShopeeHubItem` from `@/lib/shopee/hubClient` (Task 2).
- Consumes: `isAuthorizedAdminRequest(request: NextRequest): boolean` from `@/lib/adminSession` (existing, used identically by every other admin route).
- Produces: `GET(request: NextRequest): Promise<NextResponse>` — exported from `src/app/api/admin/shopee/search/route.ts`. Success body: `{ items: ShopeeHubItem[], hasNextPage: boolean }`. Error bodies: `{ error: "unauthorized" }` (401) or `{ error: "search_failed" }` (502).

- [ ] **Step 1: Write the failing tests**

Create `tests/api/admin/shopee/search.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/shopee/hubClient", async () => {
  const actual = await vi.importActual("@/lib/shopee/hubClient");
  return { ...actual, searchProducts: vi.fn() };
});

import { GET } from "@/app/api/admin/shopee/search/route";
import { searchProducts } from "@/lib/shopee/hubClient";
import { ADMIN_SESSION_COOKIE, createSessionToken } from "@/lib/adminSession";

function authHeader() {
  return { cookie: `${ADMIN_SESSION_COOKIE}=${createSessionToken()}` };
}

const item = {
  itemId: "17979995178",
  title: "IKEA starfish",
  price: 45.99,
  discount: 10,
  image: "https://cf.shopee.com.br/file/abc123",
  affiliateLink: "https://shope.ee/xxxxxxxx",
  productLink: "https://shopee.com.br/product/14318452/4058376611",
  shopName: "IKEA",
  commissionRate: "0.25",
  ratingStar: 4.7,
};

function buildRequest(query = "fone bluetooth", page?: number) {
  const url = new URL("http://localhost/api/admin/shopee/search");
  url.searchParams.set("q", query);
  if (page !== undefined) {
    url.searchParams.set("page", String(page));
  }
  return new NextRequest(url, { headers: authHeader() });
}

describe("GET /api/admin/shopee/search", () => {
  beforeEach(() => {
    process.env.ADMIN_USER = "admin";
    process.env.ADMIN_PASSWORD = "test-password";
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.ADMIN_USER;
    delete process.env.ADMIN_PASSWORD;
  });

  it("returns 401 without calling searchProducts when the session cookie is missing or invalid", async () => {
    const request = new NextRequest("http://localhost/api/admin/shopee/search?q=fone");

    const response = await GET(request);

    expect(response.status).toBe(401);
    expect(searchProducts).not.toHaveBeenCalled();
  });

  it("returns items and hasNextPage from searchProducts", async () => {
    vi.mocked(searchProducts).mockResolvedValue({ items: [item], hasNextPage: true });

    const response = await GET(buildRequest());
    const body = await response.json();

    expect(searchProducts).toHaveBeenCalledWith("fone bluetooth", 1);
    expect(body).toEqual({ items: [item], hasNextPage: true });
  });

  it("passes the page query param through to searchProducts", async () => {
    vi.mocked(searchProducts).mockResolvedValue({ items: [item], hasNextPage: false });

    await GET(buildRequest("fone bluetooth", 3));

    expect(searchProducts).toHaveBeenCalledWith("fone bluetooth", 3);
  });

  it("defaults to page 1 when the page param is missing, zero, negative, or invalid", async () => {
    vi.mocked(searchProducts).mockResolvedValue({ items: [item], hasNextPage: false });

    await GET(buildRequest("fone bluetooth", -5));

    expect(searchProducts).toHaveBeenCalledWith("fone bluetooth", 1);
  });

  it("defaults the keyword to an empty string when q is missing", async () => {
    vi.mocked(searchProducts).mockResolvedValue({ items: [], hasNextPage: false });
    const request = new NextRequest("http://localhost/api/admin/shopee/search", {
      headers: authHeader(),
    });

    await GET(request);

    expect(searchProducts).toHaveBeenCalledWith("", 1);
  });

  it("returns 502 when searchProducts throws", async () => {
    vi.mocked(searchProducts).mockRejectedValue(new Error("boom"));

    const response = await GET(buildRequest());

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "search_failed" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/api/admin/shopee/search.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/admin/shopee/search/route'`.

- [ ] **Step 3: Implement the route**

Create `src/app/api/admin/shopee/search/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { searchProducts } from "@/lib/shopee/hubClient";
import { isAuthorizedAdminRequest } from "@/lib/adminSession";

export async function GET(request: NextRequest) {
  if (!isAuthorizedAdminRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const keyword = request.nextUrl.searchParams.get("q") ?? "";
  const rawPage = Number(request.nextUrl.searchParams.get("page"));
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;

  try {
    const { items, hasNextPage } = await searchProducts(keyword, page);
    return NextResponse.json({ items, hasNextPage });
  } catch (error) {
    console.error("Shopee hub search failed:", error);
    return NextResponse.json({ error: "search_failed" }, { status: 502 });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/api/admin/shopee/search.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/admin/shopee/search/route.ts tests/api/admin/shopee/search.test.ts
git commit -m "feat: add GET /api/admin/shopee/search route"
```

---

### Task 4: Shopee admin hub UI

**Files:**
- Create: `src/app/admin/shopee/ShopeeAdmin.tsx`
- Create: `src/app/admin/shopee/page.tsx`

**Interfaces:**
- Consumes (via `fetch`, not direct import): `GET /api/admin/shopee/search?q=&page=` (Task 3), returning `{ items: ShopeeHubItem[], hasNextPage: boolean }` where `ShopeeHubItem` has the shape `{ itemId, title, price, discount, image, affiliateLink, productLink, shopName, commissionRate, ratingStar }` (Task 2).
- Consumes: `isValidNote(note: string): boolean` from `@/lib/highlights/note` (existing).
- Consumes: `NOTE_TEMPLATES: string[]` from `@/lib/highlights/noteTemplates` (existing).
- Consumes (via `fetch`): `POST /api/admin/postdraft` and `POST /api/admin/highlights` (existing, already accept `marketplace: "SHOPEE"`).

- [ ] **Step 1: Create the admin page wrapper**

Create `src/app/admin/shopee/page.tsx`:

```tsx
import type { Metadata } from "next";
import ShopeeAdmin from "./ShopeeAdmin";

export const metadata: Metadata = {
  title: "Hub Shopee · Bons Achados",
  description: "Busque produtos da Shopee e destaque ofertas com link de afiliado.",
};

export default function ShopeeAdminPage() {
  return <ShopeeAdmin />;
}
```

- [ ] **Step 2: Create the admin component**

Create `src/app/admin/shopee/ShopeeAdmin.tsx`:

```tsx
"use client";

import { useCallback, useState } from "react";
import { isValidNote } from "@/lib/highlights/note";
import { NOTE_TEMPLATES } from "@/lib/highlights/noteTemplates";

type ShopeeHubItem = {
  itemId: string;
  title: string;
  price: number;
  discount: number | null;
  image: string;
  affiliateLink: string;
  productLink: string;
  shopName: string;
  commissionRate: string | null;
  ratingStar: number | null;
};

function formatPrice(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatCommission(rate: string | null): string | null {
  if (!rate) {
    return null;
  }
  const value = Number(rate);
  if (Number.isNaN(value)) {
    return null;
  }
  return `${(value * 100).toFixed(1).replace(/\.0$/, "")}%`;
}

/**
 * The commission chip is drawn as the price tag from the logo mark: a notched
 * point on the left, a punched hole, slapped on at a slight angle. Same shape
 * as the Mercado Livre hub's tag, reused here for visual consistency between
 * hubs.
 */
function CommissionTag({ label }: { label: string }) {
  return (
    <span
      className="pointer-events-none inline-flex -rotate-3 items-center gap-1.5 bg-gold py-1 pr-3 pl-4 font-display font-stretch-condensed text-[11px] font-black tracking-wide text-ink uppercase italic shadow-[0_2px_0_0_var(--color-gold-deep)]"
      style={{ clipPath: "polygon(0 50%, 10px 0, 100% 0, 100% 100%, 10px 100%)" }}
    >
      <span className="size-[5px] rounded-full bg-ink/70" aria-hidden="true" />
      <span className="sr-only">Comissão de</span>
      <span className="whitespace-nowrap">{label}</span>
    </span>
  );
}

export default function ShopeeAdmin() {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<ShopeeHubItem[]>([]);
  const [searched, setSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [copiedItemId, setCopiedItemId] = useState<string | null>(null);
  const [selectingItemId, setSelectingItemId] = useState<string | null>(null);
  const [selectedForPost, setSelectedForPost] = useState<Record<string, boolean>>({});
  const [highlightingItemId, setHighlightingItemId] = useState<string | null>(null);
  const [highlightedItems, setHighlightedItems] = useState<Record<string, boolean>>({});
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});

  const fetchPage = useCallback(async (keyword: string, targetPage: number) => {
    const response = await fetch(
      `/api/admin/shopee/search?q=${encodeURIComponent(keyword)}&page=${targetPage}`
    );
    const body = await response.json();
    if (!response.ok) {
      throw new Error("search_failed");
    }
    return { items: body.items as ShopeeHubItem[], hasNextPage: Boolean(body.hasNextPage) };
  }, []);

  const loadPage = useCallback(
    async (targetPage: number, mode: "replace" | "append") => {
      const setLoadingState = mode === "replace" ? setSearching : setLoadingMore;
      setLoadingState(true);
      setSearchError(null);
      try {
        const result = await fetchPage(query, targetPage);
        setItems((previous) => (mode === "replace" ? result.items : [...previous, ...result.items]));
        setHasMore(result.hasNextPage);
        setPage(targetPage);
        setSearched(true);
      } catch {
        setSearchError(
          mode === "replace"
            ? "A busca falhou. Tente de novo em alguns segundos."
            : "Não deu para carregar mais produtos. Tente de novo em alguns segundos."
        );
      } finally {
        setLoadingState(false);
      }
    },
    [fetchPage, query]
  );

  async function handleSearch(event: React.FormEvent) {
    event.preventDefault();
    await loadPage(1, "replace");
  }

  async function handleLoadMore() {
    await loadPage(page + 1, "append");
  }

  async function handleSelectForPost(item: ShopeeHubItem) {
    setSelectingItemId(item.itemId);
    setSearchError(null);
    try {
      const response = await fetch("/api/admin/postdraft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          marketplace: "SHOPEE",
          source: "AUTO",
          title: item.title,
          affiliateLink: item.affiliateLink,
          image: item.image,
          price: item.price,
          discount: item.discount,
          category: null,
        }),
      });
      if (response.status === 409) {
        setSelectedForPost((previous) => ({ ...previous, [item.itemId]: true }));
        return;
      }
      if (!response.ok) {
        setSearchError(`Não deu para selecionar "${item.title}" para postar. Tente de novo.`);
        return;
      }
      setSelectedForPost((previous) => ({ ...previous, [item.itemId]: true }));
    } catch {
      setSearchError(`Não deu para selecionar "${item.title}" para postar. Tente de novo.`);
    } finally {
      setSelectingItemId(null);
    }
  }

  async function handleHighlight(item: ShopeeHubItem, note: string) {
    setHighlightingItemId(item.itemId);
    setSearchError(null);
    try {
      const response = await fetch("/api/admin/highlights", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          marketplace: "SHOPEE",
          title: item.title,
          note,
          affiliateLink: item.affiliateLink,
          image: item.image,
          price: item.price,
          oldPrice: null,
          discount: item.discount,
        }),
      });
      if (!response.ok) {
        setSearchError(`Não deu para destacar "${item.title}" na vitrine. Tente de novo.`);
        return;
      }
      setHighlightedItems((previous) => ({ ...previous, [item.itemId]: true }));
    } catch {
      setSearchError(`Não deu para destacar "${item.title}" na vitrine. Tente de novo.`);
    } finally {
      setHighlightingItemId(null);
    }
  }

  async function handleCopy(itemId: string, link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setCopiedItemId(itemId);
      window.setTimeout(() => setCopiedItemId(null), 2000);
    } catch {
      setSearchError("O navegador bloqueou a cópia. Selecione o link e copie na mão.");
    }
  }

  return (
    <div>
      <div>
        <p className="font-mono text-[11px] tracking-[0.22em] text-ash uppercase">Shopee</p>
        <h1 className="font-display font-stretch-condensed text-3xl leading-none font-black text-paper uppercase italic sm:text-4xl">
          Hub de <span className="text-gold">afiliados</span>
        </h1>
      </div>

      <div className="mt-8">
        <form onSubmit={handleSearch} className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <label htmlFor="shopee-query" className="sr-only">
            O que você procura
          </label>
          <input
            id="shopee-query"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="fone bluetooth, air fryer, cadeira gamer…"
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

        <p aria-live="polite" className="sr-only">
          {searching ? "Buscando produtos" : `${items.length} produtos listados`}
        </p>

        {searchError && (
          <p
            role="alert"
            className="mt-6 rounded-xl border border-alert/40 bg-alert/10 px-4 py-3 text-sm text-paper"
          >
            {searchError}
          </p>
        )}

        {items.length > 0 && (
          <p className="mt-8 font-mono text-[11px] tracking-[0.2em] text-ash uppercase">
            {items.length} produto{items.length === 1 ? "" : "s"} · comissão em destaque
          </p>
        )}

        {searched && items.length === 0 && !searching && !searchError && (
          <p className="mt-10 text-sm text-ash">Nada encontrado para essa busca. Tente outro termo.</p>
        )}

        {!searched && !searching && !searchError && (
          <p className="mt-10 max-w-md text-sm text-ash">
            Busque um termo para ver os produtos da Shopee com preço, desconto e comissão — o link
            de afiliado já vem pronto.
          </p>
        )}

        <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item, index) => {
            const commissionLabel = formatCommission(item.commissionRate);

            return (
              <article
                key={item.itemId}
                style={{ animationDelay: `${Math.min(index, 11) * 35}ms` }}
                className="flex animate-sticker-in flex-col overflow-hidden rounded-2xl bg-paper text-ink shadow-[0_10px_24px_-14px_rgba(0,0,0,0.9)]"
              >
                <div className="relative bg-white p-3">
                  {item.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.image}
                      alt=""
                      loading="lazy"
                      className="mx-auto h-40 w-full object-contain"
                    />
                  ) : (
                    <div className="flex h-40 items-center justify-center font-mono text-xs text-ash">
                      sem imagem
                    </div>
                  )}
                  {commissionLabel && (
                    <div className="absolute top-3 right-0">
                      <CommissionTag label={commissionLabel} />
                    </div>
                  )}
                  {item.discount !== null && (
                    <span className="absolute bottom-3 left-3 rounded-md bg-ink px-2 py-0.5 font-display font-stretch-condensed text-xs font-black text-gold italic">
                      {item.discount}% off
                    </span>
                  )}
                </div>

                <div className="flex flex-1 flex-col gap-3 border-t border-ink/10 p-4">
                  <h2 className="line-clamp-2 text-sm leading-snug font-medium text-ink">
                    {item.title}
                  </h2>

                  <span className="font-display font-stretch-condensed text-2xl leading-none font-black tracking-tight text-ink tabular-nums">
                    {formatPrice(item.price)}
                  </span>

                  {(item.ratingStar !== null || item.shopName) && (
                    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-ash">
                      {item.ratingStar !== null && (
                        <span className="text-ink/70">
                          <span aria-hidden="true" className="text-gold-deep">
                            ★
                          </span>{" "}
                          {item.ratingStar}
                        </span>
                      )}
                      {item.shopName && <span>{item.shopName}</span>}
                    </p>
                  )}

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
                          onClick={() => handleCopy(item.itemId, item.affiliateLink)}
                          className="shrink-0 rounded-full bg-ink px-3 py-1.5 font-mono text-[10px] tracking-wider text-gold uppercase transition hover:bg-ink-raised focus-visible:ring-2 focus-visible:ring-ink focus-visible:outline-none"
                        >
                          {copiedItemId === item.itemId ? "Copiado" : "Copiar"}
                        </button>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleSelectForPost(item)}
                      disabled={selectingItemId === item.itemId || selectedForPost[item.itemId]}
                      className="mt-2 w-full rounded-full border border-gold/40 px-4 py-2 font-mono text-[10px] tracking-wider text-gold uppercase transition hover:bg-gold hover:text-ink focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {selectedForPost[item.itemId]
                        ? "Selecionado ✓"
                        : selectingItemId === item.itemId
                          ? "Selecionando…"
                          : "Selecionar para postar"}
                    </button>
                    {!highlightedItems[item.itemId] && (
                      <>
                        <select
                          value=""
                          onChange={(event) => {
                            const template = event.target.value;
                            if (!template) {
                              return;
                            }
                            setNoteDrafts((previous) => ({ ...previous, [item.itemId]: template }));
                            event.target.value = "";
                          }}
                          className="mt-2 w-full rounded-xl border border-ink/15 bg-ink/[0.04] p-2 font-mono text-[11px] text-ink focus-visible:border-ink focus-visible:ring-2 focus-visible:ring-ink/30 focus-visible:outline-none"
                        >
                          <option value="">Usar um modelo de nota…</option>
                          {NOTE_TEMPLATES.map((template) => (
                            <option key={template} value={template}>
                              {template}
                            </option>
                          ))}
                        </select>
                        <textarea
                          value={noteDrafts[item.itemId] ?? ""}
                          onChange={(event) =>
                            setNoteDrafts((previous) => ({
                              ...previous,
                              [item.itemId]: event.target.value,
                            }))
                          }
                          placeholder="Por que essa oferta vale a pena? (mín. 15 caracteres)"
                          rows={2}
                          className="mt-2 w-full resize-y rounded-xl border border-ink/15 bg-ink/[0.04] p-2 font-mono text-[11px] text-ink placeholder:text-ink/40 focus-visible:border-ink focus-visible:ring-2 focus-visible:ring-ink/30 focus-visible:outline-none"
                        />
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() =>
                        handleHighlight(item, (noteDrafts[item.itemId] ?? "").trim())
                      }
                      disabled={
                        highlightingItemId === item.itemId ||
                        highlightedItems[item.itemId] ||
                        !isValidNote(noteDrafts[item.itemId] ?? "")
                      }
                      className="mt-2 w-full rounded-full border border-ink/15 bg-ink/[0.04] px-4 py-2 font-mono text-[10px] tracking-wider text-ink uppercase transition hover:bg-ink hover:text-gold focus-visible:ring-2 focus-visible:ring-ink focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {highlightedItems[item.itemId]
                        ? "Na vitrine ✓"
                        : highlightingItemId === item.itemId
                          ? "Destacando…"
                          : "Destacar na vitrine"}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>

        {hasMore && (
          <div className="mt-8 flex justify-center">
            <button
              type="button"
              onClick={handleLoadMore}
              disabled={loadingMore}
              className="rounded-full border border-ink-line bg-ink-raised px-7 py-2.5 font-display font-stretch-condensed text-sm font-black tracking-wide text-paper uppercase italic transition hover:border-gold hover:text-gold focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-ink focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loadingMore ? "Carregando…" : "Carregar mais"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
```

Note: `isValidNote` is used directly in the `disabled` check on the highlight button — the placeholder text hardcodes "15 caracteres" the same way `AmazonAdmin.tsx` and `MercadoLivreAdmin.tsx` already do.

- [ ] **Step 3: Typecheck and lint**

Run: `npx tsc --noEmit && npx eslint src/app/admin/shopee/ShopeeAdmin.tsx src/app/admin/shopee/page.tsx`
Expected: no errors.

- [ ] **Step 4: Manual verification**

With `SHOPEE_APP_ID`/`SHOPEE_APP_SECRET` set in `.env` and `npm run dev` running: open `/admin/shopee` (after logging in as admin), search a real term (e.g. "fone bluetooth"), confirm results render with price, image, commission chip, and a pre-filled affiliate link. Click "Selecionar para postar" and confirm it appears in `/admin/postar`. Write a note (15+ chars) and click "Destacar na vitrine"; confirm the item appears on the public vitrine (`/`) with the correct link.

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/shopee/ShopeeAdmin.tsx src/app/admin/shopee/page.tsx
git commit -m "feat: add Shopee admin hub UI"
```

---

### Task 5: Remove manual product form, wire up navigation

**Files:**
- Delete: `src/app/admin/produtos/novo/page.tsx`
- Delete: `src/app/admin/produtos/novo/NovoProdutoForm.tsx`
- Modify: `src/app/admin/AdminNav.tsx:6-13`

**Interfaces:**
- None — this task only removes dead files and updates a static nav list; it does not change any function signature other tasks depend on.

- [ ] **Step 1: Delete the manual form files**

```bash
git rm src/app/admin/produtos/novo/page.tsx src/app/admin/produtos/novo/NovoProdutoForm.tsx
```

(If the `src/app/admin/produtos/novo/` directory is now empty, it is removed automatically by git — no separate cleanup needed.)

- [ ] **Step 2: Update the admin nav**

In `src/app/admin/AdminNav.tsx`, the `LINKS` array currently reads:

```tsx
const LINKS = [
  { href: "/admin", label: "Painel" },
  { href: "/admin/produtos/novo", label: "Cadastrar produto" },
  { href: "/admin/mercadolivre", label: "Hub Mercado Livre" },
  { href: "/admin/amazon", label: "Hub Amazon" },
  { href: "/admin/postar", label: "Postar" },
  { href: "/admin/vitrine", label: "Vitrine" },
];
```

Replace the `"Cadastrar produto"` entry with a Shopee hub link, keeping it grouped with the other hubs:

```tsx
const LINKS = [
  { href: "/admin", label: "Painel" },
  { href: "/admin/mercadolivre", label: "Hub Mercado Livre" },
  { href: "/admin/amazon", label: "Hub Amazon" },
  { href: "/admin/shopee", label: "Hub Shopee" },
  { href: "/admin/postar", label: "Postar" },
  { href: "/admin/vitrine", label: "Vitrine" },
];
```

- [ ] **Step 3: Confirm nothing else references the removed page**

Run: `grep -rn "produtos/novo\|NovoProdutoForm" src/`
Expected: no output (no remaining references).

- [ ] **Step 4: Run the full test suite**

Run: `npx vitest run`
Expected: PASS — all existing tests green, no test referenced the deleted files.

- [ ] **Step 5: Manual verification**

With `npm run dev` running: confirm `/admin/produtos/novo` returns a 404, and the admin nav shows "Hub Shopee" linking to `/admin/shopee` in place of the old "Cadastrar produto" link.

- [ ] **Step 6: Commit**

```bash
git add src/app/admin/AdminNav.tsx
git commit -m "feat: replace manual product form with Shopee hub link"
```
