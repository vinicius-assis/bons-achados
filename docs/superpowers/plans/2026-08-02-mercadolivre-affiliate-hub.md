# Mercado Livre Affiliate Hub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the non-functional Mercado Livre OAuth collection path and replace it with an admin-only, on-demand tool: paste ML session cookies once, search the affiliate catalog from a browser page, and generate an affiliate link per item with one click.

**Architecture:** A `proxy.ts` (Next.js 16's renamed `middleware.ts`) gates `/admin/*` and `/api/admin/*` behind HTTP Basic Auth. A single-row `MercadoLivreSession` table in Neon stores the pasted cookie header + CSRF token. `hubClient.ts` calls Mercado Livre's internal (undocumented, session-authenticated) Affiliate Hub search endpoint and parses its response into a flat item list. `createLink.ts` calls the matching `createLink` endpoint and records each generated link in `MercadoLivreGeneratedLink`, so the UI can mark items already linked today. The admin page at `/admin/mercadolivre` ties it together: a session form, a search box, a results grid, and a per-item "Gerar link" button.

**Tech Stack:** Next.js 16 App Router (Route Handlers + `proxy.ts`), Prisma 6 + Neon Postgres, Vitest, Tailwind CSS v4, React 19 client components.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-02-mercadolivre-affiliate-hub-design.md`
- **Next.js 16 renamed `middleware.ts` to `proxy.ts`** — the file lives at `src/proxy.ts` (same level as `src/app`), exports a function named `proxy` (not `middleware`), and its route-scoping config is `export const config = { matcher: [...] }`. Do not create a file called `middleware.ts` — it will not run.
- Hub search endpoint: `POST https://www.mercadolivre.com.br/affiliate-program/api/hub/search?is_affiliate=true&device=desktop`
- Create-link endpoint: `POST https://www.mercadolivre.com.br/affiliate-program/api/v2/affiliates/createLink`
- Both endpoints require headers `cookie: <cookieHeader>` and `x-csrf-token: <csrfToken>`, plus `content-type: application/json`, `origin: https://www.mercadolivre.com.br`, and a `referer` matching the ML page that would normally call them.
- Env vars: `ADMIN_USER`, `ADMIN_PASSWORD` (new), `ML_AFFILIATE_WORD` (kept, used as the `tag` sent to `createLink`), `DATABASE_URL`/`DIRECT_URL` (unchanged).
- Follow existing test patterns: `vi.mock("@/lib/prisma", ...)` for Prisma, `global.fetch = vi.fn()...` for HTTP calls.
- When building the admin page's markup and styling (Task 8), invoke the `frontend-design` skill (installed this session from `anthropics/skills`) for visual polish — color palette references `public/bons-achados.png` (black/gold/white).

---

## File Structure

**Removed:**
- `src/app/api/mercadolivre/oauth/start/route.ts`, `src/app/api/mercadolivre/oauth/callback/route.ts` (and the now-empty `src/app/api/mercadolivre/oauth/` directory tree)
- `src/app/api/collect/route.ts`
- `src/lib/mercadolivre/auth.ts`, `src/lib/mercadolivre/pkce.ts`, `src/lib/mercadolivre/client.ts`, `src/lib/mercadolivre/collect.ts`, `src/lib/mercadolivre/mapper.ts`
- `tests/mercadolivre/auth.test.ts`, `tests/mercadolivre/pkce.test.ts`, `tests/mercadolivre/client.test.ts`, `tests/mercadolivre/collect.test.ts`, `tests/mercadolivre/mapper.test.ts`, `tests/api/collect.test.ts`, `tests/api/mercadolivre/oauth/callback.test.ts`, `tests/api/mercadolivre/oauth/start.test.ts`
- `.github/workflows/collect.yml`
- `MercadoLivreAuth` Prisma model

**Added:**
- Modify: `prisma/schema.prisma` — remove `MercadoLivreAuth`, add `MercadoLivreSession`, `MercadoLivreGeneratedLink`
- Create: `src/proxy.ts` — Basic Auth gate
- Test: `tests/proxy.test.ts`
- Create: `src/lib/mercadolivre/session.ts` — `getSession`/`saveSession`, exports `MLHubSession` type
- Test: `tests/mercadolivre/session.test.ts`
- Create: `src/lib/mercadolivre/hubClient.ts` — `searchAffiliateProducts`, `MercadoLivreSessionExpiredError`
- Test: `tests/mercadolivre/hubClient.test.ts`
- Create: `src/lib/mercadolivre/createLink.ts` — `createAffiliateLink`, `recordGeneratedLink`, `wasGeneratedToday`
- Test: `tests/mercadolivre/createLink.test.ts`
- Create: `src/app/api/admin/mercadolivre/session/route.ts` — `GET`/`POST`
- Test: `tests/api/admin/mercadolivre/session.test.ts`
- Create: `src/app/api/admin/mercadolivre/search/route.ts` — `GET`
- Test: `tests/api/admin/mercadolivre/search.test.ts`
- Create: `src/app/api/admin/mercadolivre/generate-link/route.ts` — `POST`
- Test: `tests/api/admin/mercadolivre/generate-link.test.ts`
- Create: `src/app/admin/mercadolivre/page.tsx` — the admin UI
- Modify: `.env.example`

---

### Task 1: Remove the Mercado Livre OAuth collection path

**Files:**
- Delete: `src/app/api/mercadolivre/oauth/start/route.ts`
- Delete: `src/app/api/mercadolivre/oauth/callback/route.ts`
- Delete: `src/app/api/collect/route.ts`
- Delete: `src/lib/mercadolivre/auth.ts`
- Delete: `src/lib/mercadolivre/pkce.ts`
- Delete: `src/lib/mercadolivre/client.ts`
- Delete: `src/lib/mercadolivre/collect.ts`
- Delete: `src/lib/mercadolivre/mapper.ts`
- Delete: `tests/mercadolivre/auth.test.ts`
- Delete: `tests/mercadolivre/pkce.test.ts`
- Delete: `tests/mercadolivre/client.test.ts`
- Delete: `tests/mercadolivre/collect.test.ts`
- Delete: `tests/mercadolivre/mapper.test.ts`
- Delete: `tests/api/collect.test.ts`
- Delete: `tests/api/mercadolivre/oauth/callback.test.ts`
- Delete: `tests/api/mercadolivre/oauth/start.test.ts`
- Delete: `.github/workflows/collect.yml`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing — this task only removes dead code. `src/lib/products/types.ts` (the `ProductInput` type) and `src/lib/products/upsert.ts` are untouched; they're not specific to Mercado Livre and may be reused by a future manual-entry feature.

- [ ] **Step 1: Delete the files listed above**

```bash
rm -rf src/app/api/mercadolivre
rm -f src/app/api/collect/route.ts
rmdir src/app/api/collect 2>/dev/null || true
rm -f src/lib/mercadolivre/auth.ts src/lib/mercadolivre/pkce.ts src/lib/mercadolivre/client.ts src/lib/mercadolivre/collect.ts src/lib/mercadolivre/mapper.ts
rm -f tests/mercadolivre/auth.test.ts tests/mercadolivre/pkce.test.ts tests/mercadolivre/client.test.ts tests/mercadolivre/collect.test.ts tests/mercadolivre/mapper.test.ts
rm -f tests/api/collect.test.ts
rm -rf tests/api/mercadolivre
rm -f .github/workflows/collect.yml
```

- [ ] **Step 2: Run the full test suite to confirm nothing else references the deleted files**

Run: `npm test`
Expected: PASS — only `tests/lib/prisma.test.ts`, `tests/products/upsert.test.ts`, `tests/smoke.test.ts` should remain and pass (4 files removed this task leaves 3; confirm the count in the output matches what's left on disk under `tests/`).

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: remove non-functional Mercado Livre OAuth collection path"
```

---

### Task 2: Update the Prisma schema

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_replace_mercadolivre_auth_with_session/migration.sql` (generated)

**Interfaces:**
- Produces: Prisma models `MercadoLivreSession { id: Int, cookieHeader: String, csrfToken: String, updatedAt: DateTime }` and `MercadoLivreGeneratedLink { id: String, mlItemId: String, title: String, affiliateLink: String, generatedAt: DateTime }`, accessed later as `prisma.mercadoLivreSession.*` and `prisma.mercadoLivreGeneratedLink.*` (Tasks 3 and 5).

- [ ] **Step 1: Edit the schema**

In `prisma/schema.prisma`, delete the `MercadoLivreAuth` model entirely and add these two models after `Product`:

```prisma
model MercadoLivreSession {
  id           Int      @id @default(1)
  cookieHeader String
  csrfToken    String
  updatedAt    DateTime @updatedAt
}

model MercadoLivreGeneratedLink {
  id            String   @id @default(cuid())
  mlItemId      String
  title         String
  affiliateLink String
  generatedAt   DateTime @default(now())

  @@index([mlItemId, generatedAt])
}
```

- [ ] **Step 2: Run the migration**

```bash
npx prisma migrate dev --name replace_mercadolivre_auth_with_session
```

Expected: a new folder under `prisma/migrations/` is created; the command reports it applied successfully against the Neon database (it will both drop the `MercadoLivreAuth` table and create the two new ones).

- [ ] **Step 3: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat: replace MercadoLivreAuth with MercadoLivreSession and MercadoLivreGeneratedLink"
```

---

### Task 3: Session storage (`session.ts`)

**Files:**
- Create: `src/lib/mercadolivre/session.ts`
- Test: `tests/mercadolivre/session.test.ts`

**Interfaces:**
- Consumes: `prisma.mercadoLivreSession.findUnique`, `prisma.mercadoLivreSession.upsert` (Task 2's model).
- Produces: `type MLHubSession = { cookieHeader: string; csrfToken: string }`, `getSession(): Promise<MLHubSession | null>`, `saveSession(cookieHeader: string, csrfToken: string): Promise<void>` — consumed by Tasks 4, 5, 6, 7.

- [ ] **Step 1: Write the failing test**

Create `tests/mercadolivre/session.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { getSession, saveSession } from "@/lib/mercadolivre/session";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    mercadoLivreSession: {
      findUnique: vi.fn(),
      upsert: vi.fn().mockResolvedValue({}),
    },
  },
}));

describe("session", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("getSession returns null when no row exists", async () => {
    vi.mocked(prisma.mercadoLivreSession.findUnique).mockResolvedValue(null);

    const session = await getSession();

    expect(session).toBeNull();
  });

  it("getSession returns the stored cookieHeader and csrfToken", async () => {
    vi.mocked(prisma.mercadoLivreSession.findUnique).mockResolvedValue({
      id: 1,
      cookieHeader: "a=b; c=d",
      csrfToken: "token123",
      updatedAt: new Date(),
    });

    const session = await getSession();

    expect(session).toEqual({ cookieHeader: "a=b; c=d", csrfToken: "token123" });
  });

  it("saveSession upserts the single row by id 1", async () => {
    await saveSession("a=b; c=d", "token123");

    expect(prisma.mercadoLivreSession.upsert).toHaveBeenCalledWith({
      where: { id: 1 },
      create: { id: 1, cookieHeader: "a=b; c=d", csrfToken: "token123" },
      update: { cookieHeader: "a=b; c=d", csrfToken: "token123" },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/mercadolivre/session.test.ts`
Expected: FAIL with "Cannot find module '@/lib/mercadolivre/session'"

- [ ] **Step 3: Write the implementation**

Create `src/lib/mercadolivre/session.ts`:

```ts
import { prisma } from "@/lib/prisma";

export type MLHubSession = {
  cookieHeader: string;
  csrfToken: string;
};

export async function getSession(): Promise<MLHubSession | null> {
  const row = await prisma.mercadoLivreSession.findUnique({ where: { id: 1 } });
  if (!row) {
    return null;
  }
  return { cookieHeader: row.cookieHeader, csrfToken: row.csrfToken };
}

export async function saveSession(cookieHeader: string, csrfToken: string): Promise<void> {
  await prisma.mercadoLivreSession.upsert({
    where: { id: 1 },
    create: { id: 1, cookieHeader, csrfToken },
    update: { cookieHeader, csrfToken },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/mercadolivre/session.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/mercadolivre/session.ts tests/mercadolivre/session.test.ts
git commit -m "feat: add Mercado Livre session storage"
```

---

### Task 4: Hub search client (`hubClient.ts`)

**Files:**
- Create: `src/lib/mercadolivre/hubClient.ts`
- Test: `tests/mercadolivre/hubClient.test.ts`

**Interfaces:**
- Consumes: `MLHubSession` type (Task 3).
- Produces: `type MLHubItem`, `class MercadoLivreSessionExpiredError extends Error`, `searchAffiliateProducts(query: string, session: MLHubSession): Promise<MLHubItem[]>` — consumed by Task 7 (search route).

- [ ] **Step 1: Write the failing test**

Create `tests/mercadolivre/hubClient.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  searchAffiliateProducts,
  MercadoLivreSessionExpiredError,
} from "@/lib/mercadolivre/hubClient";

const session = { cookieHeader: "a=b; c=d", csrfToken: "token123" };

const FIXTURE_RESPONSE = {
  polycard_client_model: {
    polycards: [
      {
        metadata: {
          id: "MLB2766771378",
          url: "www.mercadolivre.com.br/creatina-1kg-suplemento/p/MLB18725310",
          url_params: "?pdp_filters=item_id%3AMLB2766771378",
        },
        pictures: {
          pictures: [{ id: "894230-MLA111390627295_052026" }],
        },
        components: [
          { type: "title", id: "title", title: { text: "Creatina 1kg Suplemento" } },
          {
            type: "review_compacted",
            id: "review_compacted",
            review_compacted: {
              values: [
                { key: "icon_star_fill", type: "icon" },
                { key: "label", type: "label", label: { text: "4.8" } },
                { key: "label2", type: "label", label: { text: "| +500mil vendidos" } },
              ],
            },
          },
          {
            type: "chip",
            id: "affiliates_commission_chip",
            chip: { label: { text: "25%" } },
          },
          {
            type: "price",
            id: "price",
            price: {
              previous_price: { value: 239.9, currency: "BRL" },
              current_price: { value: 65.9, currency: "BRL" },
              discount_label: { text: "72% OFF" },
            },
          },
        ],
      },
      {
        // A card with no discount and no picture, to exercise the optional fields.
        metadata: {
          id: "MLB9999999999",
          url: "www.mercadolivre.com.br/produto-sem-desconto/p/MLB1111111111",
          url_params: "",
        },
        pictures: { pictures: [] },
        components: [
          { type: "title", id: "title", title: { text: "Produto Sem Desconto" } },
          {
            type: "price",
            id: "price",
            price: { current_price: { value: 50 } },
          },
        ],
      },
    ],
  },
};

describe("searchAffiliateProducts", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends the query, cookies, and csrf token, and returns parsed items", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => FIXTURE_RESPONSE,
    } as Response);

    const items = await searchAffiliateProducts("creatina", session);

    expect(global.fetch).toHaveBeenCalledWith(
      "https://www.mercadolivre.com.br/affiliate-program/api/hub/search?is_affiliate=true&device=desktop",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          cookie: "a=b; c=d",
          "x-csrf-token": "token123",
        }),
        body: JSON.stringify({
          search: "creatina",
          sort: "relevance",
          filters: [{ id: "best_seller", value: true }],
          offset: 0,
        }),
      })
    );

    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      itemId: "MLB2766771378",
      title: "Creatina 1kg Suplemento",
      price: 65.9,
      oldPrice: 239.9,
      discountLabel: "72% OFF",
      rating: 4.8,
      soldLabel: "+500mil vendidos",
      image: "https://http2.mlstatic.com/D_Q_NP_2X_894230-MLA111390627295_052026-AB.webp",
      permalink:
        "https://www.mercadolivre.com.br/creatina-1kg-suplemento/p/MLB18725310?pdp_filters=item_id%3AMLB2766771378",
      commissionLabel: "25%",
    });
    expect(items[1]).toEqual({
      itemId: "MLB9999999999",
      title: "Produto Sem Desconto",
      price: 50,
      oldPrice: null,
      discountLabel: null,
      rating: null,
      soldLabel: null,
      image: "",
      permalink: "https://www.mercadolivre.com.br/produto-sem-desconto/p/MLB1111111111",
      commissionLabel: null,
    });
  });

  it("throws MercadoLivreSessionExpiredError on a 403 response", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 403 } as Response);

    await expect(searchAffiliateProducts("creatina", session)).rejects.toThrow(
      MercadoLivreSessionExpiredError
    );
  });

  it("throws MercadoLivreSessionExpiredError on a 401 response", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401 } as Response);

    await expect(searchAffiliateProducts("creatina", session)).rejects.toThrow(
      MercadoLivreSessionExpiredError
    );
  });

  it("throws a generic error on other non-ok statuses", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 } as Response);

    await expect(searchAffiliateProducts("creatina", session)).rejects.toThrow(
      "Mercado Livre hub search failed: 500"
    );
  });

  it("throws MercadoLivreSessionExpiredError when the response body has no polycards", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ unexpected: "shape" }),
    } as Response);

    await expect(searchAffiliateProducts("creatina", session)).rejects.toThrow(
      MercadoLivreSessionExpiredError
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/mercadolivre/hubClient.test.ts`
Expected: FAIL with "Cannot find module '@/lib/mercadolivre/hubClient'"

- [ ] **Step 3: Write the implementation**

Create `src/lib/mercadolivre/hubClient.ts`:

```ts
import type { MLHubSession } from "@/lib/mercadolivre/session";

const HUB_SEARCH_URL =
  "https://www.mercadolivre.com.br/affiliate-program/api/hub/search?is_affiliate=true&device=desktop";

export type MLHubItem = {
  itemId: string;
  title: string;
  price: number;
  oldPrice: number | null;
  discountLabel: string | null;
  rating: number | null;
  soldLabel: string | null;
  image: string;
  permalink: string;
  commissionLabel: string | null;
};

export class MercadoLivreSessionExpiredError extends Error {
  constructor() {
    super("Mercado Livre session expired or invalid");
    this.name = "MercadoLivreSessionExpiredError";
  }
}

type PolycardComponent = {
  type: string;
  [key: string]: unknown;
};

function findComponent(
  components: PolycardComponent[],
  type: string
): PolycardComponent | undefined {
  return components.find((component) => component.type === type);
}

function buildImageUrl(pictureId: string | undefined): string {
  if (!pictureId) {
    return "";
  }
  return `https://http2.mlstatic.com/D_Q_NP_2X_${pictureId}-AB.webp`;
}

function buildPermalink(url: string, urlParams: string | undefined): string {
  const base = url.startsWith("http") ? url : `https://${url}`;
  return urlParams ? `${base}${urlParams}` : base;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseCard(card: any): MLHubItem | null {
  const components: PolycardComponent[] = card.components ?? [];
  const titleComponent = findComponent(components, "title");
  const priceComponent = findComponent(components, "price");
  if (!titleComponent || !priceComponent || !card.metadata?.id) {
    return null;
  }

  const reviewComponent = findComponent(components, "review_compacted");
  const chipComponent = findComponent(components, "chip");

  let rating: number | null = null;
  let soldLabel: string | null = null;
  if (reviewComponent) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const values: any[] = (reviewComponent as any).review_compacted?.values ?? [];
    const ratingValue = values.find((value) => value.key === "label");
    const soldValue = values.find((value) => value.key === "label2");
    rating = ratingValue?.label?.text ? parseFloat(ratingValue.label.text) : null;
    soldLabel = soldValue?.label?.text ? soldValue.label.text.replace(/^\|\s*/, "") : null;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const price = (priceComponent as any).price;
  const pictureId = card.pictures?.pictures?.[0]?.id;

  return {
    itemId: card.metadata.id,
    title: titleComponent.title.text,
    price: price.current_price.value,
    oldPrice: price.previous_price?.value ?? null,
    discountLabel: price.discount_label?.text ?? null,
    rating,
    soldLabel,
    image: buildImageUrl(pictureId),
    permalink: buildPermalink(card.metadata.url, card.metadata.url_params),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    commissionLabel: (chipComponent as any)?.chip?.label?.text ?? null,
  };
}

export async function searchAffiliateProducts(
  query: string,
  session: MLHubSession
): Promise<MLHubItem[]> {
  const response = await fetch(HUB_SEARCH_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/plain, */*",
      origin: "https://www.mercadolivre.com.br",
      referer: "https://www.mercadolivre.com.br/afiliados/hub",
      cookie: session.cookieHeader,
      "x-csrf-token": session.csrfToken,
    },
    body: JSON.stringify({
      search: query,
      sort: "relevance",
      filters: [{ id: "best_seller", value: true }],
      offset: 0,
    }),
  });

  if (response.status === 401 || response.status === 403) {
    throw new MercadoLivreSessionExpiredError();
  }
  if (!response.ok) {
    throw new Error(`Mercado Livre hub search failed: ${response.status}`);
  }

  const data = await response.json();
  const cards = data?.polycard_client_model?.polycards;
  if (!Array.isArray(cards)) {
    throw new MercadoLivreSessionExpiredError();
  }

  return cards
    .map(parseCard)
    .filter((item): item is MLHubItem => item !== null);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/mercadolivre/hubClient.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/mercadolivre/hubClient.ts tests/mercadolivre/hubClient.test.ts
git commit -m "feat: add Mercado Livre affiliate hub search client"
```

---

### Task 5: Link generation (`createLink.ts`)

**Files:**
- Create: `src/lib/mercadolivre/createLink.ts`
- Test: `tests/mercadolivre/createLink.test.ts`

**Interfaces:**
- Consumes: `MLHubSession` (Task 3), `MercadoLivreSessionExpiredError` (Task 4), `prisma.mercadoLivreGeneratedLink.create`/`findFirst` (Task 2).
- Produces: `createAffiliateLink(url: string, session: MLHubSession): Promise<{ shortUrl: string; longUrl: string }>`, `recordGeneratedLink(mlItemId: string, title: string, affiliateLink: string): Promise<void>`, `wasGeneratedToday(mlItemId: string): Promise<boolean>` — all consumed by Task 7 (generate-link and search routes).

- [ ] **Step 1: Write the failing test**

Create `tests/mercadolivre/createLink.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  createAffiliateLink,
  recordGeneratedLink,
  wasGeneratedToday,
} from "@/lib/mercadolivre/createLink";
import { MercadoLivreSessionExpiredError } from "@/lib/mercadolivre/hubClient";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    mercadoLivreGeneratedLink: {
      create: vi.fn().mockResolvedValue({}),
      findFirst: vi.fn(),
    },
  },
}));

const session = { cookieHeader: "a=b; c=d", csrfToken: "token123" };

describe("createAffiliateLink", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("sends the url and tag, and returns the short and long urls", async () => {
    process.env.ML_AFFILIATE_WORD = "bonsachados";
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        urls: [{ short_url: "https://meli.la/abc123", long_url: "https://www.mercadolivre.com.br/social/..." }],
      }),
    } as Response);

    const result = await createAffiliateLink("https://www.mercadolivre.com.br/produto/p/MLB1", session);

    expect(global.fetch).toHaveBeenCalledWith(
      "https://www.mercadolivre.com.br/affiliate-program/api/v2/affiliates/createLink",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          cookie: "a=b; c=d",
          "x-csrf-token": "token123",
        }),
        body: JSON.stringify({
          urls: ["https://www.mercadolivre.com.br/produto/p/MLB1"],
          tag: "bonsachados",
        }),
      })
    );
    expect(result).toEqual({
      shortUrl: "https://meli.la/abc123",
      longUrl: "https://www.mercadolivre.com.br/social/...",
    });

    delete process.env.ML_AFFILIATE_WORD;
  });

  it("throws MercadoLivreSessionExpiredError on a 403 response", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 403 } as Response);

    await expect(
      createAffiliateLink("https://www.mercadolivre.com.br/produto/p/MLB1", session)
    ).rejects.toThrow(MercadoLivreSessionExpiredError);
  });

  it("throws when the response is missing short_url/long_url", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ urls: [{}] }),
    } as Response);

    await expect(
      createAffiliateLink("https://www.mercadolivre.com.br/produto/p/MLB1", session)
    ).rejects.toThrow("Mercado Livre createLink response missing short_url/long_url");
  });
});

describe("recordGeneratedLink", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("creates a MercadoLivreGeneratedLink row", async () => {
    await recordGeneratedLink("MLB123", "Some Product", "https://meli.la/abc123");

    expect(prisma.mercadoLivreGeneratedLink.create).toHaveBeenCalledWith({
      data: { mlItemId: "MLB123", title: "Some Product", affiliateLink: "https://meli.la/abc123" },
    });
  });
});

describe("wasGeneratedToday", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns true when a row exists for today", async () => {
    vi.mocked(prisma.mercadoLivreGeneratedLink.findFirst).mockResolvedValue({
      id: "1",
      mlItemId: "MLB123",
      title: "x",
      affiliateLink: "y",
      generatedAt: new Date(),
    });

    expect(await wasGeneratedToday("MLB123")).toBe(true);
  });

  it("returns false when no row exists for today", async () => {
    vi.mocked(prisma.mercadoLivreGeneratedLink.findFirst).mockResolvedValue(null);

    expect(await wasGeneratedToday("MLB123")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/mercadolivre/createLink.test.ts`
Expected: FAIL with "Cannot find module '@/lib/mercadolivre/createLink'"

- [ ] **Step 3: Write the implementation**

Create `src/lib/mercadolivre/createLink.ts`:

```ts
import { prisma } from "@/lib/prisma";
import type { MLHubSession } from "@/lib/mercadolivre/session";
import { MercadoLivreSessionExpiredError } from "@/lib/mercadolivre/hubClient";

const CREATE_LINK_URL =
  "https://www.mercadolivre.com.br/affiliate-program/api/v2/affiliates/createLink";

export type AffiliateLinkResult = {
  shortUrl: string;
  longUrl: string;
};

export async function createAffiliateLink(
  url: string,
  session: MLHubSession
): Promise<AffiliateLinkResult> {
  const response = await fetch(CREATE_LINK_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/plain, */*",
      origin: "https://www.mercadolivre.com.br",
      referer: "https://www.mercadolivre.com.br/afiliados/linkbuilder",
      cookie: session.cookieHeader,
      "x-csrf-token": session.csrfToken,
    },
    body: JSON.stringify({ urls: [url], tag: process.env.ML_AFFILIATE_WORD ?? "" }),
  });

  if (response.status === 401 || response.status === 403) {
    throw new MercadoLivreSessionExpiredError();
  }
  if (!response.ok) {
    throw new Error(`Mercado Livre createLink failed: ${response.status}`);
  }

  const data = await response.json();
  const result = data?.urls?.[0];
  if (!result?.short_url || !result?.long_url) {
    throw new Error("Mercado Livre createLink response missing short_url/long_url");
  }

  return { shortUrl: result.short_url, longUrl: result.long_url };
}

export async function recordGeneratedLink(
  mlItemId: string,
  title: string,
  affiliateLink: string
): Promise<void> {
  await prisma.mercadoLivreGeneratedLink.create({
    data: { mlItemId, title, affiliateLink },
  });
}

export async function wasGeneratedToday(mlItemId: string): Promise<boolean> {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const row = await prisma.mercadoLivreGeneratedLink.findFirst({
    where: { mlItemId, generatedAt: { gte: startOfToday } },
  });

  return row !== null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/mercadolivre/createLink.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/mercadolivre/createLink.ts tests/mercadolivre/createLink.test.ts
git commit -m "feat: add Mercado Livre affiliate link generation"
```

---

### Task 6: Admin Basic Auth gate (`proxy.ts`)

**Files:**
- Create: `src/proxy.ts`
- Test: `tests/proxy.test.ts`

**Interfaces:**
- Consumes: `ADMIN_USER`, `ADMIN_PASSWORD` env vars.
- Produces: gates `/admin/*` and `/api/admin/*` — consumed implicitly by Tasks 7 and 8 (nothing imports `proxy.ts` directly; Next.js invokes it automatically for matching routes).

- [ ] **Step 1: Write the failing test**

Create `tests/proxy.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";

describe("proxy (admin Basic Auth)", () => {
  beforeEach(() => {
    process.env.ADMIN_USER = "admin";
    process.env.ADMIN_PASSWORD = "test-password";
  });

  afterEach(() => {
    delete process.env.ADMIN_USER;
    delete process.env.ADMIN_PASSWORD;
  });

  it("rejects requests without an Authorization header", () => {
    const request = new NextRequest("http://localhost/admin/mercadolivre");

    const response = proxy(request);

    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toBe('Basic realm="Admin"');
  });

  it("rejects requests with the wrong password", () => {
    const encoded = Buffer.from("admin:wrong-password").toString("base64");
    const request = new NextRequest("http://localhost/admin/mercadolivre", {
      headers: { authorization: `Basic ${encoded}` },
    });

    const response = proxy(request);

    expect(response.status).toBe(401);
  });

  it("rejects requests with the wrong user", () => {
    const encoded = Buffer.from("someone-else:test-password").toString("base64");
    const request = new NextRequest("http://localhost/admin/mercadolivre", {
      headers: { authorization: `Basic ${encoded}` },
    });

    const response = proxy(request);

    expect(response.status).toBe(401);
  });

  it("allows requests with the correct credentials", () => {
    const encoded = Buffer.from("admin:test-password").toString("base64");
    const request = new NextRequest("http://localhost/admin/mercadolivre", {
      headers: { authorization: `Basic ${encoded}` },
    });

    const response = proxy(request);

    expect(response.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/proxy.test.ts`
Expected: FAIL with "Cannot find module '@/proxy'"

- [ ] **Step 3: Write the implementation**

Create `src/proxy.ts`:

```ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const UNAUTHORIZED_RESPONSE = () =>
  new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Admin"' },
  });

export function proxy(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Basic ")) {
    return UNAUTHORIZED_RESPONSE();
  }

  const encoded = authHeader.slice("Basic ".length);
  const decoded = Buffer.from(encoded, "base64").toString("utf-8");
  const [providedUser, providedPassword] = decoded.split(":");

  if (providedUser !== process.env.ADMIN_USER || providedPassword !== process.env.ADMIN_PASSWORD) {
    return UNAUTHORIZED_RESPONSE();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/proxy.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/proxy.ts tests/proxy.test.ts
git commit -m "feat: gate /admin routes behind HTTP Basic Auth"
```

---

### Task 7: Admin API routes

**Files:**
- Create: `src/app/api/admin/mercadolivre/session/route.ts`
- Test: `tests/api/admin/mercadolivre/session.test.ts`
- Create: `src/app/api/admin/mercadolivre/search/route.ts`
- Test: `tests/api/admin/mercadolivre/search.test.ts`
- Create: `src/app/api/admin/mercadolivre/generate-link/route.ts`
- Test: `tests/api/admin/mercadolivre/generate-link.test.ts`

**Interfaces:**
- Consumes: `getSession`/`saveSession` (Task 3), `searchAffiliateProducts`/`MercadoLivreSessionExpiredError` (Task 4), `createAffiliateLink`/`recordGeneratedLink`/`wasGeneratedToday` (Task 5).
- Produces: the three routes the admin page (Task 8) calls via `fetch`.

- [ ] **Step 1: Write the failing tests**

Create `tests/api/admin/mercadolivre/session.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/mercadolivre/session", () => ({
  getSession: vi.fn(),
  saveSession: vi.fn().mockResolvedValue(undefined),
}));

import { GET, POST } from "@/app/api/admin/mercadolivre/session/route";
import { getSession, saveSession } from "@/lib/mercadolivre/session";

describe("GET /api/admin/mercadolivre/session", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns hasSession: false when no session is stored", async () => {
    vi.mocked(getSession).mockResolvedValue(null);

    const response = await GET();
    const body = await response.json();

    expect(body).toEqual({ hasSession: false });
  });

  it("returns hasSession: true when a session is stored", async () => {
    vi.mocked(getSession).mockResolvedValue({ cookieHeader: "a=b", csrfToken: "t" });

    const response = await GET();
    const body = await response.json();

    expect(body).toEqual({ hasSession: true });
  });
});

describe("POST /api/admin/mercadolivre/session", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("saves the session and returns saved: true", async () => {
    const request = new NextRequest("http://localhost/api/admin/mercadolivre/session", {
      method: "POST",
      body: JSON.stringify({ cookieHeader: "a=b; c=d", csrfToken: "token123" }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(saveSession).toHaveBeenCalledWith("a=b; c=d", "token123");
    expect(body).toEqual({ saved: true });
  });

  it("returns 400 when cookieHeader or csrfToken is missing", async () => {
    const request = new NextRequest("http://localhost/api/admin/mercadolivre/session", {
      method: "POST",
      body: JSON.stringify({ cookieHeader: "" }),
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(saveSession).not.toHaveBeenCalled();
  });
});
```

Create `tests/api/admin/mercadolivre/search.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/mercadolivre/session", () => ({
  getSession: vi.fn(),
}));
vi.mock("@/lib/mercadolivre/hubClient", async () => {
  const actual = await vi.importActual("@/lib/mercadolivre/hubClient");
  return {
    ...actual,
    searchAffiliateProducts: vi.fn(),
  };
});
vi.mock("@/lib/mercadolivre/createLink", () => ({
  wasGeneratedToday: vi.fn().mockResolvedValue(false),
}));

import { GET } from "@/app/api/admin/mercadolivre/search/route";
import { getSession } from "@/lib/mercadolivre/session";
import { searchAffiliateProducts, MercadoLivreSessionExpiredError } from "@/lib/mercadolivre/hubClient";
import { wasGeneratedToday } from "@/lib/mercadolivre/createLink";

const item = {
  itemId: "MLB123",
  title: "Produto",
  price: 10,
  oldPrice: null,
  discountLabel: null,
  rating: null,
  soldLabel: null,
  image: "",
  permalink: "https://www.mercadolivre.com.br/p/MLB123",
  commissionLabel: null,
};

describe("GET /api/admin/mercadolivre/search", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 session_expired when no session is stored", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const request = new NextRequest("http://localhost/api/admin/mercadolivre/search?q=creatina");

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: "session_expired" });
    expect(searchAffiliateProducts).not.toHaveBeenCalled();
  });

  it("returns items annotated with generatedToday", async () => {
    vi.mocked(getSession).mockResolvedValue({ cookieHeader: "a=b", csrfToken: "t" });
    vi.mocked(searchAffiliateProducts).mockResolvedValue([item]);
    vi.mocked(wasGeneratedToday).mockResolvedValue(true);
    const request = new NextRequest("http://localhost/api/admin/mercadolivre/search?q=creatina");

    const response = await GET(request);
    const body = await response.json();

    expect(searchAffiliateProducts).toHaveBeenCalledWith("creatina", { cookieHeader: "a=b", csrfToken: "t" });
    expect(body).toEqual({ items: [{ ...item, generatedToday: true }] });
  });

  it("returns 401 session_expired when the client throws MercadoLivreSessionExpiredError", async () => {
    vi.mocked(getSession).mockResolvedValue({ cookieHeader: "a=b", csrfToken: "t" });
    vi.mocked(searchAffiliateProducts).mockRejectedValue(new MercadoLivreSessionExpiredError());
    const request = new NextRequest("http://localhost/api/admin/mercadolivre/search?q=creatina");

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: "session_expired" });
  });

  it("returns 502 on any other error", async () => {
    vi.mocked(getSession).mockResolvedValue({ cookieHeader: "a=b", csrfToken: "t" });
    vi.mocked(searchAffiliateProducts).mockRejectedValue(new Error("boom"));
    const request = new NextRequest("http://localhost/api/admin/mercadolivre/search?q=creatina");

    const response = await GET(request);

    expect(response.status).toBe(502);
  });
});
```

Create `tests/api/admin/mercadolivre/generate-link.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/mercadolivre/session", () => ({
  getSession: vi.fn(),
}));
vi.mock("@/lib/mercadolivre/createLink", () => ({
  createAffiliateLink: vi.fn(),
  recordGeneratedLink: vi.fn().mockResolvedValue(undefined),
}));

import { POST } from "@/app/api/admin/mercadolivre/generate-link/route";
import { getSession } from "@/lib/mercadolivre/session";
import { createAffiliateLink, recordGeneratedLink } from "@/lib/mercadolivre/createLink";
import { MercadoLivreSessionExpiredError } from "@/lib/mercadolivre/hubClient";

function buildRequest(body: unknown) {
  return new NextRequest("http://localhost/api/admin/mercadolivre/generate-link", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/admin/mercadolivre/generate-link", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when itemId, url, or title is missing", async () => {
    const response = await POST(buildRequest({ itemId: "MLB1" }));

    expect(response.status).toBe(400);
    expect(getSession).not.toHaveBeenCalled();
  });

  it("returns 401 session_expired when no session is stored", async () => {
    vi.mocked(getSession).mockResolvedValue(null);

    const response = await POST(buildRequest({ itemId: "MLB1", url: "https://x", title: "Produto" }));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: "session_expired" });
  });

  it("creates the link, records it, and returns the affiliate link", async () => {
    vi.mocked(getSession).mockResolvedValue({ cookieHeader: "a=b", csrfToken: "t" });
    vi.mocked(createAffiliateLink).mockResolvedValue({
      shortUrl: "https://meli.la/abc",
      longUrl: "https://www.mercadolivre.com.br/social/...",
    });

    const response = await POST(buildRequest({ itemId: "MLB1", url: "https://x", title: "Produto" }));
    const body = await response.json();

    expect(createAffiliateLink).toHaveBeenCalledWith("https://x", { cookieHeader: "a=b", csrfToken: "t" });
    expect(recordGeneratedLink).toHaveBeenCalledWith("MLB1", "Produto", "https://meli.la/abc");
    expect(body).toEqual({ affiliateLink: "https://meli.la/abc" });
  });

  it("returns 401 session_expired when createAffiliateLink throws MercadoLivreSessionExpiredError", async () => {
    vi.mocked(getSession).mockResolvedValue({ cookieHeader: "a=b", csrfToken: "t" });
    vi.mocked(createAffiliateLink).mockRejectedValue(new MercadoLivreSessionExpiredError());

    const response = await POST(buildRequest({ itemId: "MLB1", url: "https://x", title: "Produto" }));

    expect(response.status).toBe(401);
    expect(recordGeneratedLink).not.toHaveBeenCalled();
  });

  it("returns 502 on any other error", async () => {
    vi.mocked(getSession).mockResolvedValue({ cookieHeader: "a=b", csrfToken: "t" });
    vi.mocked(createAffiliateLink).mockRejectedValue(new Error("boom"));

    const response = await POST(buildRequest({ itemId: "MLB1", url: "https://x", title: "Produto" }));

    expect(response.status).toBe(502);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/api/admin/mercadolivre/`
Expected: FAIL — none of the three route modules exist yet.

- [ ] **Step 3: Write the implementations**

Create `src/app/api/admin/mercadolivre/session/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { getSession, saveSession } from "@/lib/mercadolivre/session";

export async function GET() {
  const session = await getSession();
  return NextResponse.json({ hasSession: session !== null });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { cookieHeader, csrfToken } = body;

  if (!cookieHeader || !csrfToken) {
    return NextResponse.json(
      { error: "cookieHeader and csrfToken are required" },
      { status: 400 }
    );
  }

  await saveSession(cookieHeader, csrfToken);

  return NextResponse.json({ saved: true });
}
```

Create `src/app/api/admin/mercadolivre/search/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/mercadolivre/session";
import { searchAffiliateProducts, MercadoLivreSessionExpiredError } from "@/lib/mercadolivre/hubClient";
import { wasGeneratedToday } from "@/lib/mercadolivre/createLink";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q") ?? "";

  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "session_expired" }, { status: 401 });
  }

  try {
    const items = await searchAffiliateProducts(query, session);
    const annotated = await Promise.all(
      items.map(async (item) => ({
        ...item,
        generatedToday: await wasGeneratedToday(item.itemId),
      }))
    );
    return NextResponse.json({ items: annotated });
  } catch (error) {
    if (error instanceof MercadoLivreSessionExpiredError) {
      return NextResponse.json({ error: "session_expired" }, { status: 401 });
    }
    console.error("Mercado Livre hub search failed:", error);
    return NextResponse.json({ error: "search_failed" }, { status: 502 });
  }
}
```

Create `src/app/api/admin/mercadolivre/generate-link/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/mercadolivre/session";
import { MercadoLivreSessionExpiredError } from "@/lib/mercadolivre/hubClient";
import { createAffiliateLink, recordGeneratedLink } from "@/lib/mercadolivre/createLink";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { itemId, url, title } = body;

  if (!itemId || !url || !title) {
    return NextResponse.json(
      { error: "itemId, url and title are required" },
      { status: 400 }
    );
  }

  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "session_expired" }, { status: 401 });
  }

  try {
    const { shortUrl } = await createAffiliateLink(url, session);
    await recordGeneratedLink(itemId, title, shortUrl);
    return NextResponse.json({ affiliateLink: shortUrl });
  } catch (error) {
    if (error instanceof MercadoLivreSessionExpiredError) {
      return NextResponse.json({ error: "session_expired" }, { status: 401 });
    }
    console.error("Mercado Livre generate-link failed:", error);
    return NextResponse.json({ error: "generate_link_failed" }, { status: 502 });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/api/admin/mercadolivre/`
Expected: PASS (13 tests across the 3 files)

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: PASS, all suites

- [ ] **Step 6: Commit**

```bash
git add src/app/api/admin/mercadolivre tests/api/admin/mercadolivre
git commit -m "feat: add admin API routes for Mercado Livre session, search, and link generation"
```

---

### Task 8: Admin page UI

**Files:**
- Create: `src/app/admin/mercadolivre/page.tsx`

**Interfaces:**
- Consumes: `GET/POST /api/admin/mercadolivre/session`, `GET /api/admin/mercadolivre/search`, `POST /api/admin/mercadolivre/generate-link` (Task 7) via `fetch` from the browser.
- Produces: nothing consumed by other tasks — this is the final UI.

- [ ] **Step 1: Read the frontend-design skill**

Before writing this page's markup and styling, invoke the `frontend-design` skill (installed this session from `anthropics/skills`) and follow its guidance for distinctive, intentional visual choices — typography, spacing, color usage. Use `public/bons-achados.png` (black / gold / white "price tag" mark) as the brand reference; don't default to generic gray-on-white admin-panel styling.

- [ ] **Step 2: Write the page**

Create `src/app/admin/mercadolivre/page.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import Image from "next/image";

type MLHubItem = {
  itemId: string;
  title: string;
  price: number;
  oldPrice: number | null;
  discountLabel: string | null;
  rating: number | null;
  soldLabel: string | null;
  image: string;
  permalink: string;
  commissionLabel: string | null;
  generatedToday: boolean;
};

function formatPrice(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function MercadoLivreAdminPage() {
  const [hasSession, setHasSession] = useState<boolean | null>(null);
  const [cookieHeader, setCookieHeader] = useState("");
  const [csrfToken, setCsrfToken] = useState("");
  const [savingSession, setSavingSession] = useState(false);

  const [query, setQuery] = useState("");
  const [items, setItems] = useState<MLHubItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [generatingItemId, setGeneratingItemId] = useState<string | null>(null);
  const [generatedLinks, setGeneratedLinks] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch("/api/admin/mercadolivre/session")
      .then((response) => response.json())
      .then((body) => setHasSession(body.hasSession))
      .catch(() => setHasSession(false));
  }, []);

  async function handleSaveSession(event: React.FormEvent) {
    event.preventDefault();
    setSavingSession(true);
    try {
      const response = await fetch("/api/admin/mercadolivre/session", {
        method: "POST",
        body: JSON.stringify({ cookieHeader, csrfToken }),
      });
      if (response.ok) {
        setHasSession(true);
        setCookieHeader("");
        setCsrfToken("");
      }
    } finally {
      setSavingSession(false);
    }
  }

  async function handleSearch(event: React.FormEvent) {
    event.preventDefault();
    setSearching(true);
    setSearchError(null);
    try {
      const response = await fetch(`/api/admin/mercadolivre/search?q=${encodeURIComponent(query)}`);
      const body = await response.json();
      if (response.status === 401) {
        setHasSession(false);
        setSearchError("Sessão expirada — cole os cookies de novo abaixo.");
        return;
      }
      if (!response.ok) {
        setSearchError("Não foi possível buscar produtos. Tente novamente.");
        return;
      }
      setItems(body.items);
    } finally {
      setSearching(false);
    }
  }

  async function handleGenerateLink(item: MLHubItem) {
    setGeneratingItemId(item.itemId);
    try {
      const response = await fetch("/api/admin/mercadolivre/generate-link", {
        method: "POST",
        body: JSON.stringify({ itemId: item.itemId, url: item.permalink, title: item.title }),
      });
      const body = await response.json();
      if (response.status === 401) {
        setHasSession(false);
        setSearchError("Sessão expirada — cole os cookies de novo abaixo.");
        return;
      }
      if (response.ok) {
        setGeneratedLinks((previous) => ({ ...previous, [item.itemId]: body.affiliateLink }));
        setItems((previous) =>
          previous.map((existing) =>
            existing.itemId === item.itemId ? { ...existing, generatedToday: true } : existing
          )
        );
      }
    } finally {
      setGeneratingItemId(null);
    }
  }

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-50">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <header className="mb-10 flex items-center gap-4">
          <Image src="/bons-achados.png" alt="Bons Achados" width={56} height={56} className="rounded-full" />
          <div>
            <h1 className="text-2xl font-black tracking-tight text-amber-400">
              Mercado Livre — Hub de Afiliados
            </h1>
            <p className="text-sm text-neutral-400">
              Busque produtos e gere links de afiliado sob demanda.
            </p>
          </div>
        </header>

        {hasSession === false && (
          <section className="mb-10 rounded-xl border border-amber-400/30 bg-neutral-900 p-6">
            <h2 className="mb-4 text-lg font-bold text-amber-400">Configurar sessão</h2>
            <p className="mb-4 text-sm text-neutral-400">
              Abra o DevTools do navegador na aba Network enquanto usa o Hub de Afiliados do
              Mercado Livre, copie o cabeçalho <code className="text-amber-300">Cookie</code> e o
              header <code className="text-amber-300">x-csrf-token</code> de qualquer requisição, e
              cole abaixo.
            </p>
            <form onSubmit={handleSaveSession} className="space-y-4">
              <textarea
                required
                value={cookieHeader}
                onChange={(event) => setCookieHeader(event.target.value)}
                placeholder="Cookie header completo"
                rows={4}
                className="w-full rounded-lg border border-neutral-700 bg-neutral-950 p-3 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-amber-400 focus:outline-none"
              />
              <input
                required
                value={csrfToken}
                onChange={(event) => setCsrfToken(event.target.value)}
                placeholder="x-csrf-token"
                className="w-full rounded-lg border border-neutral-700 bg-neutral-950 p-3 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-amber-400 focus:outline-none"
              />
              <button
                type="submit"
                disabled={savingSession}
                className="rounded-full bg-amber-400 px-6 py-2 text-sm font-bold text-neutral-950 transition hover:bg-amber-300 disabled:opacity-50"
              >
                {savingSession ? "Salvando..." : "Salvar sessão"}
              </button>
            </form>
          </section>
        )}

        {hasSession && (
          <>
            <form onSubmit={handleSearch} className="mb-8 flex gap-3">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar produtos (ex: eletronicos em oferta)"
                className="flex-1 rounded-full border border-neutral-700 bg-neutral-900 px-5 py-3 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-amber-400 focus:outline-none"
              />
              <button
                type="submit"
                disabled={searching}
                className="rounded-full bg-amber-400 px-6 py-3 text-sm font-bold text-neutral-950 transition hover:bg-amber-300 disabled:opacity-50"
              >
                {searching ? "Buscando..." : "Listar produtos"}
              </button>
            </form>

            {searchError && (
              <p className="mb-6 rounded-lg border border-red-500/30 bg-red-950/40 p-4 text-sm text-red-300">
                {searchError}
              </p>
            )}

            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((item) => (
                <article
                  key={item.itemId}
                  className="flex flex-col overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900"
                >
                  {item.image && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.image} alt={item.title} className="h-40 w-full object-contain bg-white p-2" />
                  )}
                  <div className="flex flex-1 flex-col gap-2 p-4">
                    <h3 className="line-clamp-2 text-sm font-semibold text-neutral-100">{item.title}</h3>
                    <div className="flex items-baseline gap-2">
                      <span className="text-lg font-black text-amber-400">{formatPrice(item.price)}</span>
                      {item.oldPrice && (
                        <span className="text-xs text-neutral-500 line-through">
                          {formatPrice(item.oldPrice)}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2 text-xs text-neutral-400">
                      {item.discountLabel && (
                        <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-emerald-300">
                          {item.discountLabel}
                        </span>
                      )}
                      {item.rating && <span>★ {item.rating}</span>}
                      {item.commissionLabel && (
                        <span className="rounded-full bg-amber-400/20 px-2 py-0.5 text-amber-300">
                          Comissão {item.commissionLabel}
                        </span>
                      )}
                    </div>
                    {item.soldLabel && <p className="text-xs text-neutral-500">{item.soldLabel}</p>}

                    <div className="mt-auto pt-3">
                      {generatedLinks[item.itemId] ? (
                        <input
                          readOnly
                          value={generatedLinks[item.itemId]}
                          onFocus={(event) => event.currentTarget.select()}
                          className="w-full rounded-lg border border-emerald-500/40 bg-neutral-950 p-2 text-xs text-emerald-300"
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleGenerateLink(item)}
                          disabled={generatingItemId === item.itemId || item.generatedToday}
                          className="w-full rounded-full bg-amber-400 px-4 py-2 text-xs font-bold text-neutral-950 transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-400"
                        >
                          {item.generatedToday
                            ? "Já gerado hoje"
                            : generatingItemId === item.itemId
                              ? "Gerando..."
                              : "Gerar link"}
                        </button>
                      )}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
```

- [ ] **Step 3: Manual check**

Run `npm run dev`, visit `http://localhost:3000/admin/mercadolivre` (with the correct HTTP Basic Auth credentials). Confirm the session form renders. This step cannot be fully automated — no test is required for this page per the plan, since it's a thin composition of the already-tested API routes (Task 7) verified end-to-end in Manual Verification after this plan completes.

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/mercadolivre/page.tsx
git commit -m "feat: add Mercado Livre affiliate hub admin page"
```

---

### Task 9: Update `.env.example`

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Replace the file contents**

Replace the full contents of `.env.example`:

```
DATABASE_URL="postgresql://user:password@host/db?sslmode=require&pgbouncer=true"
DIRECT_URL="postgresql://user:password@host/db?sslmode=require"
ML_AFFILIATE_WORD="your-affiliate-word"
ADMIN_USER="admin"
ADMIN_PASSWORD="change-me"
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "docs: update .env.example for the Mercado Livre affiliate hub"
```

---

## Manual Verification (after all tasks)

This cannot be fully automated because it depends on real Mercado Livre session cookies and a live deployment.

1. Deploy to Vercel; set `ADMIN_USER`, `ADMIN_PASSWORD`, `ML_AFFILIATE_WORD` in Vercel env vars (in addition to the existing `DATABASE_URL`/`DIRECT_URL`). Remove the now-unused `COLLECT_SECRET`, `ML_CLIENT_ID`, `ML_CLIENT_SECRET`, `ML_REDIRECT_URI`, `ML_AFFILIATE_TOOL`, `ML_SEARCH_QUERIES` if desired.
2. Confirm `npx prisma migrate deploy` applied cleanly against Neon (drops `MercadoLivreAuth`, creates the two new tables).
3. Visit `/admin/mercadolivre` — confirm the browser's Basic Auth prompt appears; confirm a wrong password is rejected.
4. Open Chrome DevTools on `mercadolivre.com.br` (logged in), go to the Affiliate Hub, capture a request's `Cookie` header and `x-csrf-token`, paste them into the admin page's form, save.
5. Search a term (e.g. "eletronicos em oferta"); confirm real results render with correct title/price/discount/rating/image.
6. Click "Gerar link" on one item; confirm the link matches the `createLink` response shape, and the button flips to "Já gerado hoje".
7. Re-search the same term; confirm that item still shows as generated today.
8. Manually delete or corrupt the stored `csrfToken` (e.g. via `npx prisma studio`) and re-search; confirm the page shows the "sessão expirada" message rather than a silent failure.
