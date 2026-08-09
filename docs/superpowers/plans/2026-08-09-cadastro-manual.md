# Cadastro Manual de Itens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a manual multi-item registration form at `/admin/cadastro` that detects the marketplace from the affiliate link, writes each item to `Highlight`, and optionally also queues it in `PostDraft` for posting.

**Architecture:** A pure detection module (`src/lib/manualItems/detectMarketplace.ts`) maps an affiliate link to a `Marketplace` and extracts a `productId`, shared by both the API route (server) and the form component (client, for the live badge) since it has no runtime dependencies. An orchestration module (`src/lib/manualItems/createManualItems.ts`) validates all links up front (all-or-nothing), then creates `Highlight` rows one by one (duplicate-per-item, non-blocking), optionally also creating a `PostDraft` when requested. A new API route exposes this over HTTP, and a new admin page/client component provides the multi-row form with per-row status badges.

**Tech Stack:** Next.js API routes, Prisma (`Highlight`, `PostDraft` models — already exist, no schema changes), React client component, Vitest for tests.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-09-cadastro-manual-design.md`
- New page at `/admin/cadastro`, linked from `AdminNav` between "Hub Shopee" and "Postar".
- Detection patterns (exact, from spec): Mercado Livre `https://meli.la/...`, Shopee `https://s.shopee.com.br/...`, Amazon `https://www.amazon.com.br/dp/<ASIN>...`.
- Discount field is a direct percentage (number), not an old-price calculation.
- `productId` extraction falls back to a random id (`crypto.randomUUID()`) when the recognized link doesn't yield a clean id — never blocks cadastro.
- Unrecognized link → reject the **entire batch**, no writes at all.
- Duplicate `[marketplace, productId]` in `Highlight` → skip only that item, others in the batch still process.
- `note` for manual `Highlight` rows comes from the existing `pickRandomNote()` pool (`src/lib/highlights/noteTemplates.ts`) — no new UI field for it.
- `PostDraft.imageTitle` for queued manual items defaults to the item's `name` (editable later in `/admin/postar`, no modal in this flow).
- `PostDraft.source` for these items is `"MANUAL"`.
- Follow existing code conventions: Tailwind classes/visual language already used in `AmazonAdmin.tsx` / `PostarQueue.tsx` (rounded-2xl cards, `font-mono text-[11px] tracking-wider uppercase` labels, gold accent buttons), `isAuthorizedAdminRequest` guard on every admin API route, Vitest with `vi.mock("@/lib/prisma", ...)` pattern used throughout `tests/lib/**` and `tests/api/admin/**`.

---

### Task 1: Marketplace detection module

**Files:**
- Create: `src/lib/manualItems/detectMarketplace.ts`
- Test: `tests/lib/manualItems/detectMarketplace.test.ts`

**Interfaces:**
- Consumes: nothing (pure functions, only `crypto.randomUUID` from Node stdlib and the `Marketplace` type from `@prisma/client`).
- Produces:
  - `detectMarketplace(affiliateLink: string): Marketplace | null`
  - `extractProductId(marketplace: Marketplace, affiliateLink: string): string`

  Both are consumed by Task 2 (`createManualItems.ts`) and Task 4 (the client form component, for the live badge).

- [ ] **Step 1: Write the failing test**

```typescript
// tests/lib/manualItems/detectMarketplace.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { detectMarketplace, extractProductId } from "@/lib/manualItems/detectMarketplace";

describe("detectMarketplace", () => {
  it("detects Mercado Livre from a meli.la link", () => {
    expect(detectMarketplace("https://meli.la/abc123")).toBe("MERCADO_LIVRE");
  });

  it("detects Shopee from a s.shopee.com.br link", () => {
    expect(detectMarketplace("https://s.shopee.com.br/3LqZ9x8y")).toBe("SHOPEE");
  });

  it("detects Amazon from a /dp/ link", () => {
    expect(detectMarketplace("https://www.amazon.com.br/dp/B08N5WRWNW?tag=meutag-20")).toBe(
      "AMAZON"
    );
  });

  it("returns null for a link that matches none of the patterns", () => {
    expect(detectMarketplace("https://example.com/produto/123")).toBeNull();
  });

  it("returns null for an amazon.com.br link without /dp/", () => {
    expect(detectMarketplace("https://www.amazon.com.br/gp/product/B08N5WRWNW")).toBeNull();
  });
});

describe("extractProductId", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("extracts the ASIN from an Amazon link", () => {
    expect(extractProductId("AMAZON", "https://www.amazon.com.br/dp/B08N5WRWNW?tag=x")).toBe(
      "B08N5WRWNW"
    );
  });

  it("extracts the short code from a Shopee link", () => {
    expect(extractProductId("SHOPEE", "https://s.shopee.com.br/3LqZ9x8y")).toBe("3LqZ9x8y");
  });

  it("extracts the slug from a Mercado Livre link", () => {
    expect(extractProductId("MERCADO_LIVRE", "https://meli.la/abc123")).toBe("abc123");
  });

  it("strips query strings and trailing slashes when extracting", () => {
    expect(extractProductId("SHOPEE", "https://s.shopee.com.br/3LqZ9x8y?utm=x")).toBe("3LqZ9x8y");
  });

  it("falls back to a random id when the recognized link has no extractable id", () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue("11111111-1111-1111-1111-111111111111");
    expect(extractProductId("AMAZON", "https://www.amazon.com.br/dp/")).toBe(
      "11111111-1111-1111-1111-111111111111"
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/manualItems/detectMarketplace.test.ts`
Expected: FAIL with "Cannot find module '@/lib/manualItems/detectMarketplace'"

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/manualItems/detectMarketplace.ts
import { randomUUID } from "crypto";
import type { Marketplace } from "@prisma/client";

const PATTERNS: Array<[Marketplace, RegExp]> = [
  ["MERCADO_LIVRE", /^https:\/\/meli\.la\//],
  ["SHOPEE", /^https:\/\/s\.shopee\.com\.br\//],
  ["AMAZON", /^https:\/\/www\.amazon\.com\.br\/dp\//],
];

export function detectMarketplace(affiliateLink: string): Marketplace | null {
  const match = PATTERNS.find(([, pattern]) => pattern.test(affiliateLink));
  return match ? match[0] : null;
}

const ID_PATTERNS: Record<Marketplace, RegExp> = {
  AMAZON: /\/dp\/([A-Za-z0-9]+)/,
  SHOPEE: /^https:\/\/s\.shopee\.com\.br\/([^/?#]+)/,
  MERCADO_LIVRE: /^https:\/\/meli\.la\/([^/?#]+)/,
};

export function extractProductId(marketplace: Marketplace, affiliateLink: string): string {
  const match = affiliateLink.match(ID_PATTERNS[marketplace]);
  return match ? match[1] : randomUUID();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/manualItems/detectMarketplace.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/manualItems/detectMarketplace.ts tests/lib/manualItems/detectMarketplace.test.ts
git commit -m "feat: detect marketplace and extract product id from affiliate link"
```

---

### Task 2: Highlight duplicate lookup

**Files:**
- Modify: `src/lib/highlights/store.ts`
- Test: `tests/lib/highlights/store.test.ts`

**Interfaces:**
- Consumes: `prisma.highlight.findUnique` (Prisma client, already imported in this file as `prisma`).
- Produces: `findHighlightByProductId(marketplace: Marketplace, productId: string): Promise<Highlight | null>`, consumed by Task 3.

The `Highlight` model has `@@unique([marketplace, productId])` in `prisma/schema.prisma`, which Prisma exposes as the compound key `marketplace_productId` on `findUnique`.

- [ ] **Step 1: Write the failing test**

Add to `tests/lib/highlights/store.test.ts`, inside the existing mock (add `findUnique: vi.fn()` to the `prisma.highlight` mock object at the top of the file) and add this new `describe` block plus the new import:

```typescript
// at the top of the vi.mock("@/lib/prisma", ...) factory, add findUnique to the highlight mock:
//   highlight: {
//     create: vi.fn(),
//     findMany: vi.fn(),
//     findUnique: vi.fn(),
//     deleteMany: vi.fn(),
//   },

// add to the import from "@/lib/highlights/store":
//   findHighlightByProductId,

describe("findHighlightByProductId", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("looks up by the compound marketplace+productId key", async () => {
    vi.mocked(prisma.highlight.findUnique).mockResolvedValue({ id: "hl1" } as never);

    const result = await findHighlightByProductId("AMAZON", "B08N5WRWNW");

    expect(prisma.highlight.findUnique).toHaveBeenCalledWith({
      where: { marketplace_productId: { marketplace: "AMAZON", productId: "B08N5WRWNW" } },
    });
    expect(result).toEqual({ id: "hl1" });
  });

  it("returns null when no row matches", async () => {
    vi.mocked(prisma.highlight.findUnique).mockResolvedValue(null);

    const result = await findHighlightByProductId("AMAZON", "NOPE");

    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/highlights/store.test.ts`
Expected: FAIL with "findHighlightByProductId is not a function" (or import error)

- [ ] **Step 3: Write the implementation**

Add to `src/lib/highlights/store.ts` (after `createHighlight`):

```typescript
export async function findHighlightByProductId(
  marketplace: Marketplace,
  productId: string
): Promise<Highlight | null> {
  return prisma.highlight.findUnique({
    where: { marketplace_productId: { marketplace, productId } },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/highlights/store.test.ts`
Expected: PASS (all tests in the file, including the two new ones)

- [ ] **Step 5: Commit**

```bash
git add src/lib/highlights/store.ts tests/lib/highlights/store.test.ts
git commit -m "feat: add findHighlightByProductId lookup for duplicate detection"
```

---

### Task 3: Manual items orchestration

**Files:**
- Create: `src/lib/manualItems/createManualItems.ts`
- Test: `tests/lib/manualItems/createManualItems.test.ts`

**Interfaces:**
- Consumes:
  - `detectMarketplace(affiliateLink: string): Marketplace | null` (Task 1)
  - `extractProductId(marketplace: Marketplace, affiliateLink: string): string` (Task 1)
  - `findHighlightByProductId(marketplace: Marketplace, productId: string): Promise<Highlight | null>` (Task 2)
  - `createHighlight(input: CreateHighlightInput): Promise<Highlight>` (existing, `src/lib/highlights/store.ts`)
  - `pickRandomNote(): string` (existing, `src/lib/highlights/noteTemplates.ts`)
  - `createPostDraft(input: CreatePostDraftInput): Promise<CreatePostDraftResult>` (existing, `src/lib/postdraft/store.ts`) — `CreatePostDraftResult` is `{ status: "created"; id: string; category: string } | { status: "duplicate"; createdAt: Date }`
- Produces:
  - `type ManualItemInput = { imageLink: string; name: string; price: number; discount: number | null; affiliateLink: string; addToPost: boolean }`
  - `type ManualItemResult = { status: "created"; id: string } | { status: "created_and_queued"; id: string; postDraftId: string } | { status: "duplicate" }`
  - `type CreateManualItemsResult = { ok: false; unrecognizedIndices: number[] } | { ok: true; results: ManualItemResult[] }`
  - `createManualItems(items: ManualItemInput[]): Promise<CreateManualItemsResult>`, consumed by Task 5 (API route).

- [ ] **Step 1: Write the failing test**

```typescript
// tests/lib/manualItems/createManualItems.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/highlights/store", () => ({
  createHighlight: vi.fn(),
  findHighlightByProductId: vi.fn(),
}));
vi.mock("@/lib/highlights/noteTemplates", () => ({
  pickRandomNote: vi.fn(() => "Nota de teste."),
}));
vi.mock("@/lib/postdraft/store", () => ({
  createPostDraft: vi.fn(),
}));

import { createHighlight, findHighlightByProductId } from "@/lib/highlights/store";
import { createPostDraft } from "@/lib/postdraft/store";
import { createManualItems, type ManualItemInput } from "@/lib/manualItems/createManualItems";

const AMAZON_ITEM: ManualItemInput = {
  imageLink: "https://img.example/1.webp",
  name: "Fone Bluetooth JBL",
  price: 199.9,
  discount: 20,
  affiliateLink: "https://www.amazon.com.br/dp/B08N5WRWNW?tag=x",
  addToPost: false,
};

const SHOPEE_ITEM: ManualItemInput = {
  imageLink: "https://img.example/2.webp",
  name: "Mochila antifurto",
  price: 89.9,
  discount: null,
  affiliateLink: "https://s.shopee.com.br/3LqZ9x8y",
  addToPost: true,
};

describe("createManualItems", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("rejects the whole batch when any link is unrecognized, without writing anything", async () => {
    const badItem: ManualItemInput = { ...AMAZON_ITEM, affiliateLink: "https://example.com/x" };

    const result = await createManualItems([AMAZON_ITEM, badItem]);

    expect(result).toEqual({ ok: false, unrecognizedIndices: [1] });
    expect(createHighlight).not.toHaveBeenCalled();
  });

  it("creates a Highlight for each item and returns 'created' when addToPost is false", async () => {
    vi.mocked(findHighlightByProductId).mockResolvedValue(null);
    vi.mocked(createHighlight).mockResolvedValue({ id: "hl1" } as never);

    const result = await createManualItems([AMAZON_ITEM]);

    expect(createHighlight).toHaveBeenCalledWith({
      marketplace: "AMAZON",
      productId: "B08N5WRWNW",
      title: "Fone Bluetooth JBL",
      note: "Nota de teste.",
      affiliateLink: AMAZON_ITEM.affiliateLink,
      image: AMAZON_ITEM.imageLink,
      price: 199.9,
      oldPrice: null,
      discount: 20,
    });
    expect(createPostDraft).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, results: [{ status: "created", id: "hl1" }] });
  });

  it("also creates a PostDraft and returns 'created_and_queued' when addToPost is true", async () => {
    vi.mocked(findHighlightByProductId).mockResolvedValue(null);
    vi.mocked(createHighlight).mockResolvedValue({ id: "hl2" } as never);
    vi.mocked(createPostDraft).mockResolvedValue({
      status: "created",
      id: "pd1",
      category: "outro",
    });

    const result = await createManualItems([SHOPEE_ITEM]);

    expect(createPostDraft).toHaveBeenCalledWith({
      marketplace: "SHOPEE",
      source: "MANUAL",
      title: "Mochila antifurto",
      imageTitle: "Mochila antifurto",
      affiliateLink: SHOPEE_ITEM.affiliateLink,
      image: SHOPEE_ITEM.imageLink,
      price: 89.9,
      discount: null,
      category: null,
    });
    expect(result).toEqual({
      ok: true,
      results: [{ status: "created_and_queued", id: "hl2", postDraftId: "pd1" }],
    });
  });

  it("skips creating a Highlight and returns 'duplicate' when one already exists, without blocking other items", async () => {
    vi.mocked(findHighlightByProductId).mockImplementation(async (_marketplace, productId) =>
      productId === "B08N5WRWNW" ? ({ id: "existing" } as never) : null
    );
    vi.mocked(createHighlight).mockResolvedValue({ id: "hl-shopee" } as never);
    vi.mocked(createPostDraft).mockResolvedValue({
      status: "created",
      id: "pd1",
      category: "outro",
    });

    const result = await createManualItems([AMAZON_ITEM, SHOPEE_ITEM]);

    expect(createHighlight).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      ok: true,
      results: [
        { status: "duplicate" },
        { status: "created_and_queued", id: "hl-shopee", postDraftId: "pd1" },
      ],
    });
  });

  it("falls back to 'created' when addToPost is true but the PostDraft turns out to be a duplicate", async () => {
    vi.mocked(findHighlightByProductId).mockResolvedValue(null);
    vi.mocked(createHighlight).mockResolvedValue({ id: "hl3" } as never);
    vi.mocked(createPostDraft).mockResolvedValue({
      status: "duplicate",
      createdAt: new Date("2026-08-09T12:00:00.000Z"),
    });

    const result = await createManualItems([SHOPEE_ITEM]);

    expect(result).toEqual({ ok: true, results: [{ status: "created", id: "hl3" }] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/manualItems/createManualItems.test.ts`
Expected: FAIL with "Cannot find module '@/lib/manualItems/createManualItems'"

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/manualItems/createManualItems.ts
import type { Marketplace } from "@prisma/client";
import { createHighlight, findHighlightByProductId } from "@/lib/highlights/store";
import { pickRandomNote } from "@/lib/highlights/noteTemplates";
import { createPostDraft } from "@/lib/postdraft/store";
import { detectMarketplace, extractProductId } from "@/lib/manualItems/detectMarketplace";

export type ManualItemInput = {
  imageLink: string;
  name: string;
  price: number;
  discount: number | null;
  affiliateLink: string;
  addToPost: boolean;
};

export type ManualItemResult =
  | { status: "created"; id: string }
  | { status: "created_and_queued"; id: string; postDraftId: string }
  | { status: "duplicate" };

export type CreateManualItemsResult =
  | { ok: false; unrecognizedIndices: number[] }
  | { ok: true; results: ManualItemResult[] };

export async function createManualItems(
  items: ManualItemInput[]
): Promise<CreateManualItemsResult> {
  const detected = items.map((item) => detectMarketplace(item.affiliateLink));
  const unrecognizedIndices = detected
    .map((marketplace, index) => (marketplace === null ? index : -1))
    .filter((index) => index !== -1);

  if (unrecognizedIndices.length > 0) {
    return { ok: false, unrecognizedIndices };
  }

  const results: ManualItemResult[] = [];

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const marketplace = detected[index] as Marketplace;
    const productId = extractProductId(marketplace, item.affiliateLink);

    const existing = await findHighlightByProductId(marketplace, productId);
    if (existing) {
      results.push({ status: "duplicate" });
      continue;
    }

    const highlight = await createHighlight({
      marketplace,
      productId,
      title: item.name,
      note: pickRandomNote(),
      affiliateLink: item.affiliateLink,
      image: item.imageLink,
      price: item.price,
      oldPrice: null,
      discount: item.discount,
    });

    if (!item.addToPost) {
      results.push({ status: "created", id: highlight.id });
      continue;
    }

    const postDraftResult = await createPostDraft({
      marketplace,
      source: "MANUAL",
      title: item.name,
      imageTitle: item.name,
      affiliateLink: item.affiliateLink,
      image: item.imageLink,
      price: item.price,
      discount: item.discount,
      category: null,
    });

    if (postDraftResult.status === "duplicate") {
      results.push({ status: "created", id: highlight.id });
      continue;
    }

    results.push({
      status: "created_and_queued",
      id: highlight.id,
      postDraftId: postDraftResult.id,
    });
  }

  return { ok: true, results };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/manualItems/createManualItems.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/manualItems/createManualItems.ts tests/lib/manualItems/createManualItems.test.ts
git commit -m "feat: orchestrate manual item creation into Highlight and optional PostDraft"
```

---

### Task 4: API route

**Files:**
- Create: `src/app/api/admin/manual-items/route.ts`
- Test: `tests/api/admin/manual-items/route.test.ts`

**Interfaces:**
- Consumes:
  - `isAuthorizedAdminRequest(request: NextRequest): boolean` (existing, `src/lib/adminSession.ts`)
  - `createManualItems(items: ManualItemInput[]): Promise<CreateManualItemsResult>` (Task 3)
- Produces: `POST /api/admin/manual-items` HTTP endpoint, consumed by Task 5 (form component).
  - Request body: `{ items: Array<{ imageLink: string; name: string; price: number; discount: number | null; affiliateLink: string; addToPost: boolean }> }`
  - Response `200`: `{ results: ManualItemResult[] }`
  - Response `400` (malformed body): `{ error: "invalid_body" }`
  - Response `400` (unrecognized link(s)): `{ error: "unrecognized_link", unrecognizedIndices: number[] }`
  - Response `401`: `{ error: "unauthorized" }`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/api/admin/manual-items/route.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/adminSession", () => ({ isAuthorizedAdminRequest: vi.fn() }));
vi.mock("@/lib/manualItems/createManualItems", () => ({ createManualItems: vi.fn() }));

import { NextRequest } from "next/server";
import { POST } from "@/app/api/admin/manual-items/route";
import { isAuthorizedAdminRequest } from "@/lib/adminSession";
import { createManualItems } from "@/lib/manualItems/createManualItems";

function buildRequest(body: unknown) {
  return new NextRequest("http://localhost/api/admin/manual-items", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const VALID_ITEM = {
  imageLink: "https://img.example/1.webp",
  name: "Fone Bluetooth JBL",
  price: 199.9,
  discount: 20,
  affiliateLink: "https://www.amazon.com.br/dp/B08N5WRWNW?tag=x",
  addToPost: false,
};

describe("POST /api/admin/manual-items", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when the request is not authorized", async () => {
    vi.mocked(isAuthorizedAdminRequest).mockReturnValue(false);

    const response = await POST(buildRequest({ items: [VALID_ITEM] }));

    expect(response.status).toBe(401);
    expect(createManualItems).not.toHaveBeenCalled();
  });

  it("returns 400 when items is missing or empty", async () => {
    vi.mocked(isAuthorizedAdminRequest).mockReturnValue(true);

    const response = await POST(buildRequest({ items: [] }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toEqual({ error: "invalid_body" });
    expect(createManualItems).not.toHaveBeenCalled();
  });

  it("returns 400 when an item is missing a required field", async () => {
    vi.mocked(isAuthorizedAdminRequest).mockReturnValue(true);
    const invalidItem = { ...VALID_ITEM, name: "" };

    const response = await POST(buildRequest({ items: [invalidItem] }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toEqual({ error: "invalid_body" });
    expect(createManualItems).not.toHaveBeenCalled();
  });

  it("returns 400 with unrecognizedIndices when createManualItems rejects the batch", async () => {
    vi.mocked(isAuthorizedAdminRequest).mockReturnValue(true);
    vi.mocked(createManualItems).mockResolvedValue({ ok: false, unrecognizedIndices: [0] });

    const response = await POST(buildRequest({ items: [VALID_ITEM] }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toEqual({ error: "unrecognized_link", unrecognizedIndices: [0] });
  });

  it("returns 200 with per-item results on success, passing parsed and trimmed fields through", async () => {
    vi.mocked(isAuthorizedAdminRequest).mockReturnValue(true);
    vi.mocked(createManualItems).mockResolvedValue({
      ok: true,
      results: [{ status: "created", id: "hl1" }],
    });

    const response = await POST(
      buildRequest({ items: [{ ...VALID_ITEM, name: "  Fone Bluetooth JBL  " }] })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ results: [{ status: "created", id: "hl1" }] });
    expect(createManualItems).toHaveBeenCalledWith([{ ...VALID_ITEM, name: "Fone Bluetooth JBL" }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api/admin/manual-items/route.test.ts`
Expected: FAIL with "Cannot find module '@/app/api/admin/manual-items/route'"

- [ ] **Step 3: Write the implementation**

```typescript
// src/app/api/admin/manual-items/route.ts
import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedAdminRequest } from "@/lib/adminSession";
import { createManualItems, type ManualItemInput } from "@/lib/manualItems/createManualItems";

function parseItem(raw: unknown): ManualItemInput | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const body = raw as Record<string, unknown>;
  const imageLink = typeof body.imageLink === "string" ? body.imageLink.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const affiliateLink = typeof body.affiliateLink === "string" ? body.affiliateLink.trim() : "";
  const price = typeof body.price === "number" ? body.price : NaN;
  const discount =
    typeof body.discount === "number" && Number.isFinite(body.discount) ? body.discount : null;
  const addToPost = body.addToPost === true;

  if (
    !imageLink ||
    !name ||
    !affiliateLink ||
    Number.isNaN(price) ||
    !Number.isFinite(price) ||
    price <= 0
  ) {
    return null;
  }

  return { imageLink, name, price, discount, affiliateLink, addToPost };
}

export async function POST(request: NextRequest) {
  if (!isAuthorizedAdminRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const rawItems = Array.isArray(body?.items) ? body.items : null;
  if (!rawItems || rawItems.length === 0) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const items = rawItems.map(parseItem);
  if (items.some((item) => item === null)) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const result = await createManualItems(items as ManualItemInput[]);
  if (!result.ok) {
    return NextResponse.json(
      { error: "unrecognized_link", unrecognizedIndices: result.unrecognizedIndices },
      { status: 400 }
    );
  }

  return NextResponse.json({ results: result.results });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/api/admin/manual-items/route.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/app/api/admin/manual-items/route.ts tests/api/admin/manual-items/route.test.ts
git commit -m "feat: add POST /api/admin/manual-items endpoint"
```

---

### Task 5: Form page and component

**Files:**
- Create: `src/app/admin/cadastro/page.tsx`
- Create: `src/app/admin/cadastro/ManualItemsForm.tsx`
- Modify: `src/app/admin/AdminNav.tsx:6-12`

**Interfaces:**
- Consumes:
  - `detectMarketplace(affiliateLink: string): Marketplace | null` (Task 1) — used client-side for the live badge.
  - `POST /api/admin/manual-items` (Task 4) — request/response shapes as documented there.
- Produces: the `/admin/cadastro` page, reachable from `AdminNav`. Nothing downstream depends on this task's exports — it is the outermost layer.

This task has no automated test (it is a UI-only client component matching the existing hand-verified style of `AmazonAdmin.tsx` / `PostarQueue.tsx`, which also ship without component tests in this codebase). Verify manually per Step 4 below.

- [ ] **Step 1: Create the page wrapper**

```typescript
// src/app/admin/cadastro/page.tsx
import type { Metadata } from "next";
import ManualItemsForm from "./ManualItemsForm";

export const metadata: Metadata = {
  title: "Cadastro manual · Bons Achados",
  description: "Cadastre um ou mais itens manualmente, com detecção automática do marketplace.",
};

export default function ManualItemsPage() {
  return <ManualItemsForm />;
}
```

- [ ] **Step 2: Create the form component**

```typescript
// src/app/admin/cadastro/ManualItemsForm.tsx
"use client";

import { useState } from "react";
import type { Marketplace } from "@prisma/client";
import { detectMarketplace } from "@/lib/manualItems/detectMarketplace";

type RowStatus =
  | { kind: "idle" }
  | { kind: "created" }
  | { kind: "created_and_queued" }
  | { kind: "duplicate" }
  | { kind: "unrecognized_link" };

type FormRow = {
  key: string;
  imageLink: string;
  name: string;
  price: string;
  discount: string;
  affiliateLink: string;
  addToPost: boolean;
  status: RowStatus;
};

const MARKETPLACE_LABELS: Record<Marketplace, string> = {
  MERCADO_LIVRE: "Mercado Livre",
  AMAZON: "Amazon",
  SHOPEE: "Shopee",
};

function emptyRow(): FormRow {
  return {
    key: crypto.randomUUID(),
    imageLink: "",
    name: "",
    price: "",
    discount: "",
    affiliateLink: "",
    addToPost: false,
    status: { kind: "idle" },
  };
}

function statusLabel(status: RowStatus): string | null {
  switch (status.kind) {
    case "created":
      return "✓ Cadastrado";
    case "created_and_queued":
      return "✓ Cadastrado + na fila";
    case "duplicate":
      return "⚠ Duplicado";
    case "unrecognized_link":
      return "⚠ Link não reconhecido";
    default:
      return null;
  }
}

export default function ManualItemsForm() {
  const [rows, setRows] = useState<FormRow[]>([emptyRow()]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateRow(key: string, patch: Partial<FormRow>) {
    setRows((previous) => previous.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function addRow() {
    setRows((previous) => [...previous, emptyRow()]);
  }

  function removeRow(key: string) {
    setRows((previous) => (previous.length > 1 ? previous.filter((row) => row.key !== key) : previous));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const payloadItems = rows.map((row) => ({
      imageLink: row.imageLink.trim(),
      name: row.name.trim(),
      price: Number(row.price),
      discount: row.discount.trim() ? Number(row.discount) : null,
      affiliateLink: row.affiliateLink.trim(),
      addToPost: row.addToPost,
    }));

    try {
      const response = await fetch("/api/admin/manual-items", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items: payloadItems }),
      });
      const body = await response.json();

      if (response.status === 400 && body.error === "unrecognized_link") {
        const unrecognized = new Set<number>(body.unrecognizedIndices);
        setRows((previous) =>
          previous.map((row, index) =>
            unrecognized.has(index) ? { ...row, status: { kind: "unrecognized_link" } } : row
          )
        );
        setError("Corrija o(s) link(s) marcados abaixo e cadastre de novo.");
        return;
      }

      if (!response.ok) {
        throw new Error("submit_failed");
      }

      const results = body.results as Array<{ status: RowStatus["kind"] }>;
      setRows((previous) => {
        const withStatus = previous.map((row, index) => ({
          ...row,
          status: { kind: results[index].status } as RowStatus,
        }));
        const remaining = withStatus.filter(
          (row) => row.status.kind !== "created" && row.status.kind !== "created_and_queued"
        );
        return remaining.length > 0 ? remaining : [emptyRow()];
      });
    } catch {
      setError("Não deu para cadastrar. Verifique a conexão e tente de novo.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <p className="font-mono text-[11px] tracking-[0.22em] text-ash uppercase">Cadastro manual</p>
      <h1 className="font-display font-stretch-condensed text-3xl leading-none font-black text-paper uppercase italic sm:text-4xl">
        Adicionar <span className="text-gold">itens</span>
      </h1>
      <p className="mt-2 max-w-2xl text-sm text-ash">
        Cole o link de afiliado — o marketplace é detectado automaticamente (Mercado Livre,
        Amazon ou Shopee).
      </p>

      {error && (
        <p role="alert" className="mt-6 rounded-xl border border-alert/40 bg-alert/10 px-4 py-3 text-sm text-paper">
          {error}
        </p>
      )}

      <form onSubmit={handleSubmit} className="mt-8 space-y-5">
        {rows.map((row) => {
          const detected = detectMarketplace(row.affiliateLink.trim());
          const label = statusLabel(row.status);
          return (
            <div key={row.key} className="rounded-2xl border border-ink-line bg-ink-raised p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                {detected ? (
                  <span className="rounded-full bg-gold/15 px-3 py-1 font-mono text-[10px] tracking-wider text-gold uppercase">
                    {MARKETPLACE_LABELS[detected]}
                  </span>
                ) : (
                  <span className="font-mono text-[10px] tracking-wider text-ash uppercase">
                    marketplace não detectado
                  </span>
                )}
                <div className="flex items-center gap-3">
                  {label && (
                    <span className="font-mono text-[11px] tracking-wider text-gold uppercase">
                      {label}
                    </span>
                  )}
                  {rows.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeRow(row.key)}
                      className="font-mono text-[11px] tracking-wider text-ash uppercase transition hover:text-alert focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
                    >
                      Remover
                    </button>
                  )}
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="font-mono text-[11px] tracking-[0.18em] text-ash uppercase">Nome</span>
                  <input
                    required
                    type="text"
                    value={row.name}
                    onChange={(event) => updateRow(row.key, { name: event.target.value })}
                    className="mt-2 w-full rounded-xl border border-ink-line bg-ink p-3 text-sm text-paper placeholder:text-ash/60 focus-visible:border-gold focus-visible:ring-2 focus-visible:ring-gold/40 focus-visible:outline-none"
                  />
                </label>

                <label className="block">
                  <span className="font-mono text-[11px] tracking-[0.18em] text-ash uppercase">Link da imagem</span>
                  <input
                    required
                    type="text"
                    value={row.imageLink}
                    onChange={(event) => updateRow(row.key, { imageLink: event.target.value })}
                    className="mt-2 w-full rounded-xl border border-ink-line bg-ink p-3 text-sm text-paper placeholder:text-ash/60 focus-visible:border-gold focus-visible:ring-2 focus-visible:ring-gold/40 focus-visible:outline-none"
                  />
                </label>

                <label className="block">
                  <span className="font-mono text-[11px] tracking-[0.18em] text-ash uppercase">Preço (R$)</span>
                  <input
                    required
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={row.price}
                    onChange={(event) => updateRow(row.key, { price: event.target.value })}
                    className="mt-2 w-full rounded-xl border border-ink-line bg-ink p-3 text-sm text-paper placeholder:text-ash/60 focus-visible:border-gold focus-visible:ring-2 focus-visible:ring-gold/40 focus-visible:outline-none"
                  />
                </label>

                <label className="block">
                  <span className="font-mono text-[11px] tracking-[0.18em] text-ash uppercase">Desconto (%, opcional)</span>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    max="100"
                    value={row.discount}
                    onChange={(event) => updateRow(row.key, { discount: event.target.value })}
                    className="mt-2 w-full rounded-xl border border-ink-line bg-ink p-3 text-sm text-paper placeholder:text-ash/60 focus-visible:border-gold focus-visible:ring-2 focus-visible:ring-gold/40 focus-visible:outline-none"
                  />
                </label>

                <label className="block sm:col-span-2">
                  <span className="font-mono text-[11px] tracking-[0.18em] text-ash uppercase">Link afiliado</span>
                  <input
                    required
                    type="text"
                    value={row.affiliateLink}
                    onChange={(event) => updateRow(row.key, { affiliateLink: event.target.value })}
                    className="mt-2 w-full rounded-xl border border-ink-line bg-ink p-3 font-mono text-xs text-paper placeholder:text-ash/60 focus-visible:border-gold focus-visible:ring-2 focus-visible:ring-gold/40 focus-visible:outline-none"
                  />
                </label>
              </div>

              <label className="mt-4 flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={row.addToPost}
                  onChange={(event) => updateRow(row.key, { addToPost: event.target.checked })}
                  className="size-4 rounded border-ink-line bg-ink accent-gold"
                />
                <span className="font-mono text-[11px] tracking-wider text-ash uppercase">
                  Também adicionar para postar
                </span>
              </label>
            </div>
          );
        })}

        <div className="flex flex-wrap items-center gap-4">
          <button
            type="button"
            onClick={addRow}
            className="rounded-full border border-ink-line bg-ink-raised px-6 py-2.5 font-display font-stretch-condensed text-sm font-black tracking-wide text-paper uppercase italic transition hover:border-gold hover:text-gold focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
          >
            + Adicionar item
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-full bg-gold px-7 py-2.5 font-display font-stretch-condensed text-sm font-black tracking-wide text-ink uppercase italic transition hover:bg-paper focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-ink focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "Cadastrando…" : "Cadastrar"}
          </button>
        </div>
      </form>
    </div>
  );
}
```

- [ ] **Step 3: Wire up the nav link**

In `src/app/admin/AdminNav.tsx`, change the `LINKS` array (currently lines 6-12):

```typescript
const LINKS = [
  { href: "/admin", label: "Painel" },
  { href: "/admin/mercadolivre", label: "Hub Mercado Livre" },
  { href: "/admin/amazon", label: "Hub Amazon" },
  { href: "/admin/shopee", label: "Hub Shopee" },
  { href: "/admin/cadastro", label: "Cadastro manual" },
  { href: "/admin/postar", label: "Postar" },
];
```

- [ ] **Step 4: Manually verify in the browser**

Run: `npm run dev`

1. Log in to `/admin`, navigate to `/admin/cadastro` via the new nav link.
2. Paste an Amazon link (`https://www.amazon.com.br/dp/B08N5WRWNW?tag=x`) into "Link afiliado" — confirm the "Amazon" badge appears live as you type.
3. Fill the rest of the row, leave "também adicionar para postar" unchecked, click "+ Adicionar item", fill a second row with a Shopee link (`https://s.shopee.com.br/<any-code>`) and check "também adicionar para postar".
4. Click "Cadastrar". Confirm: both rows disappear from the form (both succeeded), the Amazon item appears in `/admin/amazon`'s grid, and the Shopee item appears both in `/admin/shopee` and in `/admin/postar`'s queue.
5. Re-submit the exact same Amazon link again (new row, same link) — confirm it shows "⚠ Duplicado" and stays in the form.
6. Submit a row with a link that matches none of the three patterns (e.g. `https://example.com/x`) — confirm it shows "⚠ Link não reconhecido" and no other rows in that same batch got created.

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/cadastro/page.tsx src/app/admin/cadastro/ManualItemsForm.tsx src/app/admin/AdminNav.tsx
git commit -m "feat: add manual item registration form at /admin/cadastro"
```

---

### Task 6: Full test suite and lint pass

**Files:** none (verification only)

**Interfaces:** none — this task only runs the project's existing checks.

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all tests pass, including every test added in Tasks 1-4.

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 3: Fix any failures**

If either command fails, fix the specific failure (do not suppress or skip checks) and re-run both commands until they pass clean.
