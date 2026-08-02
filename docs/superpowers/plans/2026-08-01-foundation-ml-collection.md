# Foundation + Mercado Livre Collection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Next.js/Prisma/PostgreSQL foundation and an automated Mercado Livre collection pipeline that runs every 10 minutes via GitHub Actions and stores raw offers in the database.

**Architecture:** A Next.js (App Router, TypeScript) project with a Prisma-backed `Product` table on Neon Postgres. A `MercadoLivreClient` calls Mercado Livre's public search and reviews endpoints; a mapper converts raw API results into the shared `ProductInput` shape; a collector orchestrates search+mapping across a configurable list of queries; an authenticated `/api/collect` route runs the collector and upserts results. A GitHub Actions cron workflow triggers that route every 10 minutes.

**Tech Stack:** Next.js 16 (App Router, TypeScript) — `create-next-app@latest` installs 16.x today, not 15 as originally planned; nothing in this plan depends on 15-specific behavior, Prisma ORM, PostgreSQL (Neon, with connection pooler), Vitest for tests, GitHub Actions for scheduling.

## Global Constraints

- All code, database/schema naming, and git commit messages must be in English (product/planning conversation may be in Portuguese, implementation artifacts must not be).
- Total infrastructure cost must stay within the free tiers used in the spec (Vercel, Neon, GitHub Actions) — no paid-tier features.
- Scheduling must use GitHub Actions (`schedule: cron`, every 10 minutes) — not Vercel Cron, whose free tier only allows 1x/day.
- Prisma must connect to Neon through its connection pooler (`DATABASE_URL` pooled, `DIRECT_URL` direct) to avoid exhausting connections as the app scales.
- This plan only covers **raw collection and storage** — no filtering, AI scoring, or distribution. Those are separate plans per `docs/superpowers/specs/2026-08-01-bons-achados-design.md`.
- `source = 'AUTO'` is the only source produced by this plan (Mercado Livre). Manual Amazon/Shopee entry is a later plan and must reuse the same `ProductInput` type and `upsertProducts` function defined here.

---

## File Structure

```
package.json
tsconfig.json
vitest.config.ts
.env.example
prisma/
  schema.prisma
src/
  lib/
    prisma.ts
    products/
      types.ts
      upsert.ts
    mercadolivre/
      client.ts
      mapper.ts
      collect.ts
  app/
    api/
      collect/
        route.ts
tests/
  smoke.test.ts
  lib/
    prisma.test.ts
  products/
    upsert.test.ts
  mercadolivre/
    client.test.ts
    mapper.test.ts
    collect.test.ts
  api/
    collect.test.ts
.github/
  workflows/
    collect.yml
```

- `src/lib/products/types.ts` — the `ProductInput` shape shared by every producer (ML now, Amazon/Shopee manual form later) and every consumer (upsert, future filter/AI).
- `src/lib/mercadolivre/*` — everything Mercado Livre–specific stays isolated here; nothing outside this folder should know about ML's API shape.
- `src/lib/products/upsert.ts` — the only place that writes to the `Product` table, so idempotency (upsert by `marketplace` + `productId`) lives in one spot.
- `src/app/api/collect/route.ts` — thin HTTP wrapper: auth check, call collector, call upsert, return count.

---

### Task 1: Project scaffold and test harness

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore` (via `create-next-app`)
- Create: `tests/smoke.test.ts`

**Interfaces:**
- Produces: a working `npm test` command (Vitest) that later tasks rely on.

- [ ] **Step 1: Scaffold the Next.js project**

Run from the repo root (`/home/vinicius/estudos/bons-achados`):

```bash
npx create-next-app@latest . --typescript --eslint --app --src-dir --tailwind --import-alias "@/*" --use-npm
```

If prompted for options not covered by the flags above, accept the defaults. The command is safe to run in this non-empty directory — it only checks for conflicts with files it intends to create (e.g. `package.json`), and none exist yet here.

- [ ] **Step 2: Install Vitest**

```bash
npm install --save-dev vitest @vitejs/plugin-react
```

- [ ] **Step 3: Configure Vitest**

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
```

Add to `package.json` `"scripts"`:

```json
"test": "vitest run"
```

- [ ] **Step 4: Write the smoke test**

Create `tests/smoke.test.ts`:

```ts
import { describe, it, expect } from "vitest";

describe("test harness", () => {
  it("runs a basic assertion", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 5: Run the test suite and verify it passes**

Run: `npm test`
Expected: PASS (1 test)

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js project with Vitest test harness"
```

---

### Task 2: Prisma schema and client singleton

**Files:**
- Create: `prisma/schema.prisma`
- Create: `src/lib/prisma.ts`
- Create: `.env.example`
- Test: `tests/lib/prisma.test.ts`

**Interfaces:**
- Produces: `prisma` (singleton `PrismaClient` instance, exported from `src/lib/prisma.ts`), and the `Product` model with fields `id, marketplace, source, productId, title, description, price, oldPrice, discount, rating, reviews, image, affiliateLink, category, seller, createdAt, posted, score` and a unique constraint on `[marketplace, productId]`.

- [ ] **Step 1: Install Prisma**

Pin to Prisma 6.x — Prisma 7 changed the schema format (`url`/`directUrl` are no longer accepted inside `datasource` blocks, and requires a separate `prisma.config.ts`), which breaks the schema and client code below.

```bash
npm install prisma@6.19.3 @prisma/client@6.19.3
npx prisma init --datasource-provider postgresql
```

This creates `prisma/schema.prisma` and a `.env` file. Delete the generated `.env` (it will be recreated from `.env.example` below) — never commit real credentials:

```bash
rm .env
```

- [ ] **Step 2: Write the schema**

Replace `prisma/schema.prisma` with:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}

enum Marketplace {
  MERCADO_LIVRE
  AMAZON
  SHOPEE
}

enum ProductSource {
  AUTO
  MANUAL
}

model Product {
  id            String        @id @default(cuid())
  marketplace   Marketplace
  source        ProductSource
  productId     String
  title         String
  description   String?
  price         Float
  oldPrice      Float?
  discount      Float?
  rating        Float?
  reviews       Int?
  image         String
  affiliateLink String
  category      String?
  seller        String?
  createdAt     DateTime      @default(now())
  posted        Boolean       @default(false)
  score         Float?

  @@unique([marketplace, productId])
}
```

- [ ] **Step 3: Create `.env.example`**

```
DATABASE_URL="postgresql://user:password@host/db?sslmode=require&pgbouncer=true"
DIRECT_URL="postgresql://user:password@host/db?sslmode=require"
COLLECT_SECRET="change-me"
ML_AFFILIATE_WORD="your-affiliate-word"
ML_AFFILIATE_TOOL="your-affiliate-tool-id"
ML_SEARCH_QUERIES="eletronicos em oferta,casa em oferta,informatica em oferta"
```

Copy it to `.env` and fill in real Neon credentials (pooled URL for `DATABASE_URL`, direct URL for `DIRECT_URL` — both available on the Neon project dashboard) before running migrations:

```bash
cp .env.example .env
```

- [ ] **Step 4: Run the migration**

```bash
npx prisma migrate dev --name init
```

Expected: migration applied, `@prisma/client` generated.

- [ ] **Step 5: Write the singleton client**

Create `src/lib/prisma.ts`:

```ts
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
```

- [ ] **Step 6: Write the test**

Create `tests/lib/prisma.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/prisma";

describe("prisma client", () => {
  it("exports a singleton PrismaClient instance with the Product model", () => {
    expect(prisma).toBeDefined();
    expect(typeof prisma.product.upsert).toBe("function");
  });
});
```

- [ ] **Step 7: Run the test suite and verify it passes**

Run: `npm test`
Expected: PASS (all tests, including the new one)

- [ ] **Step 8: Commit**

```bash
git add prisma src/lib/prisma.ts .env.example tests/lib/prisma.test.ts .gitignore
git commit -m "feat: add Prisma schema and client singleton"
```

---

### Task 3: Shared `ProductInput` type and upsert repository

**Files:**
- Create: `src/lib/products/types.ts`
- Create: `src/lib/products/upsert.ts`
- Test: `tests/products/upsert.test.ts`

**Interfaces:**
- Consumes: `prisma` from `src/lib/prisma.ts` (Task 2).
- Produces: `ProductInput` type and `upsertProducts(products: ProductInput[]): Promise<number>`, used by the collect route (Task 6) and by every future producer (manual form, other marketplaces).

- [ ] **Step 1: Write the type**

Create `src/lib/products/types.ts`:

```ts
export type Marketplace = "MERCADO_LIVRE" | "AMAZON" | "SHOPEE";
export type ProductSource = "AUTO" | "MANUAL";

export type ProductInput = {
  marketplace: Marketplace;
  source: ProductSource;
  productId: string;
  title: string;
  description: string | null;
  price: number;
  oldPrice: number | null;
  discount: number | null;
  rating: number | null;
  reviews: number | null;
  image: string;
  affiliateLink: string;
  category: string | null;
  seller: string | null;
};
```

- [ ] **Step 2: Write the failing test**

Create `tests/products/upsert.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { upsertProducts } from "@/lib/products/upsert";
import { prisma } from "@/lib/prisma";
import type { ProductInput } from "@/lib/products/types";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    product: {
      upsert: vi.fn().mockResolvedValue({}),
    },
  },
}));

const product: ProductInput = {
  marketplace: "MERCADO_LIVRE",
  source: "AUTO",
  productId: "MLB1",
  title: "Echo Dot",
  description: null,
  price: 219,
  oldPrice: 399,
  discount: 45,
  rating: 4.8,
  reviews: 24000,
  image: "http://img",
  affiliateLink: "http://item?matt_word=x&matt_tool=1",
  category: "MLB1000",
  seller: "Loja",
};

describe("upsertProducts", () => {
  it("upserts each product by marketplace and productId", async () => {
    const count = await upsertProducts([product]);

    expect(prisma.product.upsert).toHaveBeenCalledWith({
      where: {
        marketplace_productId: { marketplace: "MERCADO_LIVRE", productId: "MLB1" },
      },
      create: product,
      update: {
        title: product.title,
        price: product.price,
        oldPrice: product.oldPrice,
        discount: product.discount,
        rating: product.rating,
        reviews: product.reviews,
        image: product.image,
        affiliateLink: product.affiliateLink,
      },
    });
    expect(count).toBe(1);
  });

  it("returns 0 for an empty product list", async () => {
    vi.mocked(prisma.product.upsert).mockClear();
    const count = await upsertProducts([]);
    expect(count).toBe(0);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- tests/products/upsert.test.ts`
Expected: FAIL with "Cannot find module '@/lib/products/upsert'" (or similar)

- [ ] **Step 4: Write the implementation**

Create `src/lib/products/upsert.ts`:

```ts
import { prisma } from "@/lib/prisma";
import type { ProductInput } from "@/lib/products/types";

export async function upsertProducts(products: ProductInput[]): Promise<number> {
  let count = 0;
  for (const product of products) {
    await prisma.product.upsert({
      where: {
        marketplace_productId: {
          marketplace: product.marketplace,
          productId: product.productId,
        },
      },
      create: product,
      update: {
        title: product.title,
        price: product.price,
        oldPrice: product.oldPrice,
        discount: product.discount,
        rating: product.rating,
        reviews: product.reviews,
        image: product.image,
        affiliateLink: product.affiliateLink,
      },
    });
    count += 1;
  }
  return count;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- tests/products/upsert.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
git add src/lib/products tests/products
git commit -m "feat: add ProductInput type and upsert repository"
```

---

### Task 4: Mercado Livre API client

**Files:**
- Create: `src/lib/mercadolivre/client.ts`
- Test: `tests/mercadolivre/client.test.ts`

**Interfaces:**
- Produces: `MercadoLivreClient` class with `searchProducts(query: string): Promise<MLSearchItem[]>` and `getItemReviews(itemId: string): Promise<MLReviews>`, plus the `MLSearchItem` and `MLReviews` types, consumed by the mapper (Task 5) and collector (Task 6).

- [ ] **Step 1: Write the failing test**

Create `tests/mercadolivre/client.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { MercadoLivreClient } from "@/lib/mercadolivre/client";

describe("MercadoLivreClient", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("searchProducts returns parsed results", async () => {
    const mockResults = [
      {
        id: "MLB1",
        title: "Echo Dot",
        price: 219,
        original_price: 399,
        thumbnail: "http://img",
        permalink: "http://item",
        category_id: "MLB1000",
        seller: { nickname: "Loja" },
        sold_quantity: 500,
      },
    ];
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: mockResults }),
    } as Response);

    const client = new MercadoLivreClient();
    const results = await client.searchProducts("echo dot");

    expect(results).toEqual(mockResults);
    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.mercadolibre.com/sites/MLB/search?q=echo%20dot"
    );
  });

  it("searchProducts throws when the API responds with an error status", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 } as Response);

    const client = new MercadoLivreClient();

    await expect(client.searchProducts("echo dot")).rejects.toThrow(
      "Mercado Livre search failed: 500"
    );
  });

  it("getItemReviews returns rating and total", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ rating_average: 4.8, paging: { total: 24000 } }),
    } as Response);

    const client = new MercadoLivreClient();
    const reviews = await client.getItemReviews("MLB1");

    expect(reviews).toEqual({ rating_average: 4.8, total: 24000 });
  });

  it("getItemReviews returns zeros when the request fails", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 } as Response);

    const client = new MercadoLivreClient();
    const reviews = await client.getItemReviews("MLB1");

    expect(reviews).toEqual({ rating_average: 0, total: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/mercadolivre/client.test.ts`
Expected: FAIL with "Cannot find module '@/lib/mercadolivre/client'"

- [ ] **Step 3: Write the implementation**

Create `src/lib/mercadolivre/client.ts`:

```ts
const ML_API_BASE = "https://api.mercadolibre.com";

export type MLSearchItem = {
  id: string;
  title: string;
  price: number;
  original_price: number | null;
  thumbnail: string;
  permalink: string;
  category_id: string;
  seller: { nickname: string } | null;
  sold_quantity: number;
};

export type MLReviews = {
  rating_average: number;
  total: number;
};

export class MercadoLivreClient {
  async searchProducts(query: string): Promise<MLSearchItem[]> {
    const url = `${ML_API_BASE}/sites/MLB/search?q=${encodeURIComponent(query)}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Mercado Livre search failed: ${response.status}`);
    }
    const data = await response.json();
    return data.results as MLSearchItem[];
  }

  async getItemReviews(itemId: string): Promise<MLReviews> {
    const url = `${ML_API_BASE}/reviews/item/${itemId}`;
    const response = await fetch(url);
    if (!response.ok) {
      return { rating_average: 0, total: 0 };
    }
    const data = await response.json();
    return {
      rating_average: data.rating_average ?? 0,
      total: data.paging?.total ?? 0,
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/mercadolivre/client.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/mercadolivre/client.ts tests/mercadolivre/client.test.ts
git commit -m "feat: add Mercado Livre API client"
```

---

### Task 5: Mapper from Mercado Livre item to ProductInput

**Files:**
- Create: `src/lib/mercadolivre/mapper.ts`
- Test: `tests/mercadolivre/mapper.test.ts`

**Interfaces:**
- Consumes: `MLSearchItem`, `MLReviews` from `src/lib/mercadolivre/client.ts` (Task 4); `ProductInput` from `src/lib/products/types.ts` (Task 3).
- Produces: `mapToProductInput(item: MLSearchItem, reviews: MLReviews): ProductInput`, consumed by the collector (Task 6). Requires `ML_AFFILIATE_WORD` and `ML_AFFILIATE_TOOL` env vars to build the affiliate link (Mercado Livre's affiliate program tracks clicks via `matt_word`/`matt_tool` query params appended to the product URL).

- [ ] **Step 1: Write the failing test**

Create `tests/mercadolivre/mapper.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mapToProductInput } from "@/lib/mercadolivre/mapper";
import type { MLSearchItem, MLReviews } from "@/lib/mercadolivre/client";

const item: MLSearchItem = {
  id: "MLB1",
  title: "Echo Dot 5ª Geração",
  price: 219,
  original_price: 399,
  thumbnail: "http://img.com/echo.jpg",
  permalink: "https://produto.mercadolivre.com.br/MLB1-echo-dot",
  category_id: "MLB1000",
  seller: { nickname: "AmazonLoja" },
  sold_quantity: 24000,
};

const reviews: MLReviews = { rating_average: 4.8, total: 24000 };

describe("mapToProductInput", () => {
  beforeEach(() => {
    process.env.ML_AFFILIATE_WORD = "bonsachados";
    process.env.ML_AFFILIATE_TOOL = "12345";
  });

  afterEach(() => {
    delete process.env.ML_AFFILIATE_WORD;
    delete process.env.ML_AFFILIATE_TOOL;
  });

  it("maps a Mercado Livre item into a ProductInput", () => {
    const result = mapToProductInput(item, reviews);

    expect(result).toEqual({
      marketplace: "MERCADO_LIVRE",
      source: "AUTO",
      productId: "MLB1",
      title: "Echo Dot 5ª Geração",
      description: null,
      price: 219,
      oldPrice: 399,
      discount: 45,
      rating: 4.8,
      reviews: 24000,
      image: "http://img.com/echo.jpg",
      affiliateLink:
        "https://produto.mercadolivre.com.br/MLB1-echo-dot?matt_word=bonsachados&matt_tool=12345",
      category: "MLB1000",
      seller: "AmazonLoja",
    });
  });

  it("returns null discount and oldPrice when there is no original price", () => {
    const result = mapToProductInput({ ...item, original_price: null }, reviews);
    expect(result.discount).toBeNull();
    expect(result.oldPrice).toBeNull();
  });

  it("throws when affiliate env vars are missing", () => {
    delete process.env.ML_AFFILIATE_WORD;
    expect(() => mapToProductInput(item, reviews)).toThrow(
      "Missing ML_AFFILIATE_WORD or ML_AFFILIATE_TOOL env vars"
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/mercadolivre/mapper.test.ts`
Expected: FAIL with "Cannot find module '@/lib/mercadolivre/mapper'"

- [ ] **Step 3: Write the implementation**

Create `src/lib/mercadolivre/mapper.ts`:

```ts
import type { MLSearchItem, MLReviews } from "@/lib/mercadolivre/client";
import type { ProductInput } from "@/lib/products/types";

function buildAffiliateLink(permalink: string): string {
  const affiliateWord = process.env.ML_AFFILIATE_WORD;
  const affiliateTool = process.env.ML_AFFILIATE_TOOL;
  if (!affiliateWord || !affiliateTool) {
    throw new Error("Missing ML_AFFILIATE_WORD or ML_AFFILIATE_TOOL env vars");
  }
  const separator = permalink.includes("?") ? "&" : "?";
  return `${permalink}${separator}matt_word=${affiliateWord}&matt_tool=${affiliateTool}`;
}

function calculateDiscount(price: number, originalPrice: number | null): number | null {
  if (!originalPrice || originalPrice <= price) {
    return null;
  }
  return Math.round(((originalPrice - price) / originalPrice) * 100);
}

export function mapToProductInput(item: MLSearchItem, reviews: MLReviews): ProductInput {
  return {
    marketplace: "MERCADO_LIVRE",
    source: "AUTO",
    productId: item.id,
    title: item.title,
    description: null,
    price: item.price,
    oldPrice: item.original_price,
    discount: calculateDiscount(item.price, item.original_price),
    rating: reviews.rating_average || null,
    reviews: reviews.total || null,
    image: item.thumbnail,
    affiliateLink: buildAffiliateLink(item.permalink),
    category: item.category_id,
    seller: item.seller?.nickname ?? null,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/mercadolivre/mapper.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/mercadolivre/mapper.ts tests/mercadolivre/mapper.test.ts
git commit -m "feat: map Mercado Livre items into ProductInput"
```

---

### Task 6: Collection orchestrator

**Files:**
- Create: `src/lib/mercadolivre/collect.ts`
- Test: `tests/mercadolivre/collect.test.ts`

**Interfaces:**
- Consumes: `MercadoLivreClient` (Task 4), `mapToProductInput` (Task 5), `ProductInput` (Task 3).
- Produces: `collectMercadoLivreDeals(queries: string[], client?: MercadoLivreClient): Promise<ProductInput[]>`, consumed by the API route (Task 7).

- [ ] **Step 1: Write the failing test**

Create `tests/mercadolivre/collect.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { collectMercadoLivreDeals } from "@/lib/mercadolivre/collect";
import { MercadoLivreClient } from "@/lib/mercadolivre/client";

describe("collectMercadoLivreDeals", () => {
  afterEach(() => {
    delete process.env.ML_AFFILIATE_WORD;
    delete process.env.ML_AFFILIATE_TOOL;
  });

  it("searches every query and maps each result with its reviews", async () => {
    process.env.ML_AFFILIATE_WORD = "bonsachados";
    process.env.ML_AFFILIATE_TOOL = "12345";

    const client = new MercadoLivreClient();
    client.searchProducts = vi.fn().mockResolvedValue([
      {
        id: "MLB1",
        title: "Echo Dot",
        price: 219,
        original_price: 399,
        thumbnail: "http://img",
        permalink: "http://item",
        category_id: "MLB1000",
        seller: { nickname: "Loja" },
        sold_quantity: 500,
      },
    ]);
    client.getItemReviews = vi.fn().mockResolvedValue({ rating_average: 4.8, total: 24000 });

    const result = await collectMercadoLivreDeals(["echo dot"], client);

    expect(client.searchProducts).toHaveBeenCalledWith("echo dot");
    expect(client.getItemReviews).toHaveBeenCalledWith("MLB1");
    expect(result).toHaveLength(1);
    expect(result[0].productId).toBe("MLB1");
  });

  it("returns an empty array when no queries are given", async () => {
    const client = new MercadoLivreClient();
    const result = await collectMercadoLivreDeals([], client);
    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/mercadolivre/collect.test.ts`
Expected: FAIL with "Cannot find module '@/lib/mercadolivre/collect'"

- [ ] **Step 3: Write the implementation**

Create `src/lib/mercadolivre/collect.ts`:

```ts
import { MercadoLivreClient } from "@/lib/mercadolivre/client";
import { mapToProductInput } from "@/lib/mercadolivre/mapper";
import type { ProductInput } from "@/lib/products/types";

export async function collectMercadoLivreDeals(
  queries: string[],
  client: MercadoLivreClient = new MercadoLivreClient()
): Promise<ProductInput[]> {
  const products: ProductInput[] = [];
  for (const query of queries) {
    const items = await client.searchProducts(query);
    for (const item of items) {
      const reviews = await client.getItemReviews(item.id);
      products.push(mapToProductInput(item, reviews));
    }
  }
  return products;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/mercadolivre/collect.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/mercadolivre/collect.ts tests/mercadolivre/collect.test.ts
git commit -m "feat: orchestrate Mercado Livre collection across queries"
```

---

### Task 7: Authenticated `/api/collect` route

**Files:**
- Create: `src/app/api/collect/route.ts`
- Test: `tests/api/collect.test.ts`

**Interfaces:**
- Consumes: `collectMercadoLivreDeals` (Task 6), `upsertProducts` (Task 3).
- Produces: `POST /api/collect` HTTP endpoint — 401 without a matching `x-collect-secret` header, 200 with `{ collected: number }` otherwise. Consumed by the GitHub Actions workflow (Task 8).

- [ ] **Step 1: Write the failing test**

Create `tests/api/collect.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/mercadolivre/collect", () => ({
  collectMercadoLivreDeals: vi.fn().mockResolvedValue([{ productId: "MLB1" }]),
}));
vi.mock("@/lib/products/upsert", () => ({
  upsertProducts: vi.fn().mockResolvedValue(1),
}));

import { POST } from "@/app/api/collect/route";

describe("POST /api/collect", () => {
  beforeEach(() => {
    process.env.COLLECT_SECRET = "test-secret";
  });

  it("rejects requests without the correct secret", async () => {
    const request = new NextRequest("http://localhost/api/collect", { method: "POST" });
    const response = await POST(request);
    expect(response.status).toBe(401);
  });

  it("collects and upserts when the secret matches", async () => {
    const request = new NextRequest("http://localhost/api/collect", {
      method: "POST",
      headers: { "x-collect-secret": "test-secret" },
    });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ collected: 1 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/api/collect.test.ts`
Expected: FAIL with "Cannot find module '@/app/api/collect/route'"

- [ ] **Step 3: Write the implementation**

Create `src/app/api/collect/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { collectMercadoLivreDeals } from "@/lib/mercadolivre/collect";
import { upsertProducts } from "@/lib/products/upsert";

const DEFAULT_SEARCH_QUERIES = [
  "eletronicos em oferta",
  "casa em oferta",
  "informatica em oferta",
];

function getSearchQueries(): string[] {
  const raw = process.env.ML_SEARCH_QUERIES;
  if (!raw) {
    return DEFAULT_SEARCH_QUERIES;
  }
  return raw
    .split(",")
    .map((query) => query.trim())
    .filter(Boolean);
}

export async function POST(request: NextRequest) {
  const secret = request.headers.get("x-collect-secret");
  if (secret !== process.env.COLLECT_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const products = await collectMercadoLivreDeals(getSearchQueries());
  const count = await upsertProducts(products);

  return NextResponse.json({ collected: count });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/api/collect.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: PASS (all tests across every task so far)

- [ ] **Step 6: Commit**

```bash
git add src/app/api/collect tests/api
git commit -m "feat: add authenticated collect API route"
```

---

### Task 8: GitHub Actions cron workflow

**Files:**
- Create: `.github/workflows/collect.yml`

**Interfaces:**
- Consumes: `POST /api/collect` (Task 7), via HTTPS.
- Produces: a scheduled job that fires every 10 minutes in production.

- [ ] **Step 1: Write the workflow**

Create `.github/workflows/collect.yml`:

```yaml
name: Collect Mercado Livre deals

on:
  schedule:
    - cron: "*/10 * * * *"
  workflow_dispatch: {}

jobs:
  collect:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger collection endpoint
        run: |
          curl -sSf -X POST "${{ secrets.COLLECT_URL }}" \
            -H "x-collect-secret: ${{ secrets.COLLECT_SECRET }}"
```

- [ ] **Step 2: Document the required repository secrets**

Add a note to `.env.example` (append, do not overwrite the existing content):

```
# GitHub Actions repository secrets (Settings > Secrets and variables > Actions),
# not read from .env at runtime:
#   COLLECT_URL    = https://<your-vercel-domain>/api/collect
#   COLLECT_SECRET = same value as COLLECT_SECRET above
```

- [ ] **Step 3: Verify the workflow syntax**

Run: `npx action-validator .github/workflows/collect.yml 2>/dev/null || echo "action-validator not installed, skipping strict validation"`

If not installed, visually confirm the YAML matches the block above exactly (2-space indentation, `on.schedule` as a list).

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/collect.yml .env.example
git commit -m "ci: add GitHub Actions cron for Mercado Livre collection"
```

---

## Manual Verification (after all tasks)

This plan cannot be fully verified by automated tests alone because it depends on live external services (Mercado Livre's public API, a real Neon database, GitHub's scheduler). After all 8 tasks are committed:

1. Deploy the project to Vercel (or run `npm run dev` locally) with real `.env` values (Neon `DATABASE_URL`/`DIRECT_URL`, `COLLECT_SECRET`, `ML_AFFILIATE_WORD`, `ML_AFFILIATE_TOOL`).
2. Manually trigger the route: `curl -X POST https://<domain>/api/collect -H "x-collect-secret: <secret>"` and confirm a `{ "collected": N }` response with `N > 0`.
3. Inspect the `Product` table (`npx prisma studio`) and confirm rows exist with `source = AUTO`, `marketplace = MERCADO_LIVRE`, populated `affiliateLink` values containing `matt_word`/`matt_tool`.
4. Add `COLLECT_URL` and `COLLECT_SECRET` as GitHub repository secrets, push the workflow, and use the Actions tab's "Run workflow" button (`workflow_dispatch`) to confirm it succeeds before waiting for the first scheduled run.
