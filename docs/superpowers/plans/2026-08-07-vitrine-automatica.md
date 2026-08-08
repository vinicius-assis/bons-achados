# Vitrine automática Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace manual highlight curation with an automatic collection pipeline that fills a shared `Highlight` pool from all three marketplaces (Mercado Livre, Amazon, Shopee) on a cron schedule, paginate/filter/search the public vitrine over that pool, and turn the three admin hubs into pool viewers + manual "top up" tools (no more per-item "Destacar" button).

**Architecture:** A new `src/lib/collect/` module holds three per-marketplace collectors (`collectAmazon`, `collectMercadoLivre`, `collectShopee`) that each fetch from the existing hub clients, map results to a shared `CollectItem` shape, and write through a shared `persistItems()` (dedup via a new `Highlight.productId` unique constraint, quality filter, random note from an expanded template pool). `POST /api/cron/collect` runs all three via `Promise.allSettled` every 20 minutes; `POST /api/cron/highlights-cleanup` (existing route, schedule changed to 5am) wipes stale rows then immediately re-triggers collection. The public `/` page becomes a paginated, filterable, searchable Server Component reading only from the database. Each admin hub (`/admin/{mercadolivre,amazon,shopee}`) loads its pool on mount and, when the admin searches/paginates manually, funnels results through the same `persistItems()` path before rendering — so a manual hub search and the cron do the exact same write.

**Tech Stack:** Next.js (App Router) route handlers + Server Components, Prisma/PostgreSQL (Neon), Vitest, React client components, Tailwind CSS (existing tokens: `paper`/`ink`/`gold`/`ash`/`alert`), GitHub Actions cron.

## Global Constraints

- Spec source: `docs/superpowers/specs/2026-08-07-vitrine-automatica-design.md`.
- No IA-generated notes — a fixed pool of ~50 generic notes, rotated via `Math.random()`, no per-product mention.
- Vitrine is 100% automatic — no manual "Destacar na vitrine" anywhere; `POST /api/admin/highlights` is removed.
- Same pool feeds both the public vitrine and the admin hubs — a manual hub search writes through the same `persistItems()` used by the cron (same filter/dedup/note rules).
- Mercado Livre is in scope like the other two marketplaces.
- Collection is cron-only (every 20 min) — the public vitrine page never calls an external marketplace API at request time.
- Quality filter is minimal: drop only items with no image or a non-positive price. No minimum discount/note requirement.
- Search term list for ML/Shopee is fixed in code, one term sampled at random per cycle.
- Daily cutoff moves from midnight to **5am America/Sao_Paulo** — `startOfTodayInBrazil()` changes accordingly, and everywhere that used to mean "since midnight" now means "since the 5am cutoff."
- Session-expired / collection failures surface as a failed GitHub Actions step (existing failure-email channel), not a new notification channel.
- Every route in this plan that requires an admin session gates on `isAuthorizedAdminRequest` from `src/lib/adminSession.ts`. Every route that requires a cron secret gates on a `Authorization: Bearer <secret>` header, same pattern as `src/app/api/cron/postdraft-cleanup/route.ts` and `src/app/api/cron/highlights-cleanup/route.ts`.

---

### Task 1: Schema migration — `Highlight.productId`, drop `Product` and `MercadoLivreGeneratedLink`

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_vitrine_automatica/migration.sql` (hand-edited after Prisma generates it)

**Interfaces:**
- Produces: `Highlight` gains `productId String` (part of a new `@@unique([marketplace, productId])`), `note` becomes required with no default. `Product` model removed. `MercadoLivreGeneratedLink` model removed. `Marketplace` and `ProductSource` enums untouched (`ProductSource` still used by `PostDraft`).

- [ ] **Step 1: Edit the schema**

In `prisma/schema.prisma`, delete the entire `model Product { ... }` block (lines 22-43) and the entire `model MercadoLivreGeneratedLink { ... }` block (lines 52-60).

Replace the `Highlight` model with:

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

  @@unique([marketplace, productId])
  @@index([createdAt])
}
```

- [ ] **Step 2: Generate (but don't apply) the migration**

Run: `npx prisma migrate dev --create-only --name vitrine_automatica`

Expected: Prisma writes `prisma/migrations/<timestamp>_vitrine_automatica/migration.sql` and prints a warning that adding a required `productId` column to a table with existing rows is unsafe. This is expected — the migration is not applied yet (`--create-only`), so nothing breaks.

- [ ] **Step 3: Hand-edit the generated migration to empty `Highlight` first**

Open the generated `migration.sql`. It will contain something like an `ALTER TABLE "Highlight" ADD COLUMN "productId" TEXT NOT NULL` plus the drops for `Product` and `MercadoLivreGeneratedLink`. Add a `DELETE FROM "Highlight";` as the very first statement, before anything else in the file — old rows are curated-by-hand leftovers with no `productId` and no dedup key; they're stale anyway (the 5am cleanup cron would delete them within a day). The file should read, in order:

```sql
-- Old manually-curated highlights have no productId and would violate the
-- new NOT NULL constraint. They're stale (older than one cleanup cycle) by
-- the time this runs in production, so dropping them is safe.
DELETE FROM "Highlight";

-- (the rest of the auto-generated statements: ADD COLUMN "productId", DROP
-- DEFAULT on "note", CREATE UNIQUE INDEX, DROP TABLE "Product", DROP TABLE
-- "MercadoLivreGeneratedLink" — keep Prisma's generated SQL for these as-is,
-- just make sure DELETE FROM "Highlight" runs first)
```

- [ ] **Step 4: Apply the migration**

Run: `npx prisma migrate dev`

Expected: Prisma detects the already-created migration file and applies it (no new migration is generated since the schema already matches what's on disk). The Prisma client regenerates with `productId` on `Highlight` and no `Product`/`MercadoLivreGeneratedLink` types.

- [ ] **Step 5: Verify the generated client**

Run: `grep -n "productId" node_modules/.prisma/client/index.d.ts | grep -i highlight | head -3`
Expected: at least one match. Also run: `grep -c "MercadoLivreGeneratedLink\|^export type Product " node_modules/.prisma/client/index.d.ts` and expect `0`.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat: add Highlight.productId dedup key, drop Product and MercadoLivreGeneratedLink"
```

---

### Task 2: `src/lib/date.ts` — move the daily cutoff from midnight to 5am

**Files:**
- Modify: `src/lib/date.ts`
- Test: `tests/lib/date.test.ts` (modify existing)

**Interfaces:**
- Consumes: none
- Produces: `startOfTodayInBrazil(now?: Date): Date` — same signature, new meaning ("start of the current 5am-to-5am window in America/Sao_Paulo" instead of "midnight"). Every existing caller (`deleteStaleHighlights`, `listTodaysHighlights`/its Task 5 replacement) keeps working unchanged, they just get a different cutoff instant.

- [ ] **Step 1: Write the failing tests**

Replace the `startOfTodayInBrazil` describe block in `tests/lib/date.test.ts` with:

```typescript
describe("startOfTodayInBrazil", () => {
  it("returns yesterday's 5am (08:00 UTC) when the current time is before 5am in America/Sao_Paulo", () => {
    const now = new Date("2026-08-03T07:00:00.000Z"); // 04:00 on Aug 3 in America/Sao_Paulo
    expect(startOfTodayInBrazil(now)).toEqual(new Date("2026-08-02T08:00:00.000Z")); // 05:00 on Aug 2 BRT
  });

  it("returns today's 5am (08:00 UTC) when the current time is at or after 5am in America/Sao_Paulo", () => {
    const now = new Date("2026-08-03T08:00:00.000Z"); // 05:00 on Aug 3 in America/Sao_Paulo
    expect(startOfTodayInBrazil(now)).toEqual(new Date("2026-08-03T08:00:00.000Z"));
  });

  it("stays on today's 5am for a time later the same day", () => {
    const now = new Date("2026-08-03T15:00:00.000Z"); // 12:00 in America/Sao_Paulo
    expect(startOfTodayInBrazil(now)).toEqual(new Date("2026-08-03T08:00:00.000Z"));
  });
});
```

Leave the `formatBrazilTime` describe block untouched.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/date.test.ts`
Expected: FAIL — the first two new cases don't match the current midnight-based implementation (only the third, non-boundary case would happen to pass).

- [ ] **Step 3: Update the implementation**

Replace `startOfTodayInBrazil` in `src/lib/date.ts` with:

```typescript
const BRAZIL_UTC_OFFSET_MS = -3 * 60 * 60 * 1000; // fixed offset, Brazil has not observed DST since 2019
const CUTOFF_HOUR_BRAZIL = 5;

export function startOfTodayInBrazil(now: Date = new Date()): Date {
  const brazilNow = new Date(now.getTime() + BRAZIL_UTC_OFFSET_MS);
  const todaysCutoffMs = Date.UTC(
    brazilNow.getUTCFullYear(),
    brazilNow.getUTCMonth(),
    brazilNow.getUTCDate(),
    CUTOFF_HOUR_BRAZIL
  );
  const cutoffMs =
    brazilNow.getTime() >= todaysCutoffMs ? todaysCutoffMs : todaysCutoffMs - 24 * 60 * 60 * 1000;
  return new Date(cutoffMs - BRAZIL_UTC_OFFSET_MS);
}
```

Keep `formatBrazilTime` exactly as-is.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/date.test.ts`
Expected: PASS, all 6 tests (3 `startOfTodayInBrazil` + 3 `formatBrazilTime`).

- [ ] **Step 5: Commit**

```bash
git add src/lib/date.ts tests/lib/date.test.ts
git commit -m "feat: move the daily highlight cutoff from midnight to 5am America/Sao_Paulo"
```

---

### Task 3: `src/lib/highlights/noteTemplates.ts` — expand the note pool to ~50 and add `pickRandomNote()`

**Files:**
- Modify: `src/lib/highlights/noteTemplates.ts`
- Test: `tests/lib/highlights/noteTemplates.test.ts` (new)

**Interfaces:**
- Consumes: none
- Produces: `NOTE_TEMPLATES: string[]` (existing export, now ~50 entries instead of 10), `pickRandomNote(): string` (new)

- [ ] **Step 1: Write the failing test**

Create `tests/lib/highlights/noteTemplates.test.ts`:

```typescript
import { describe, it, expect, vi, afterEach } from "vitest";
import { NOTE_TEMPLATES, pickRandomNote } from "@/lib/highlights/noteTemplates";
import { isValidNote } from "@/lib/highlights/note";

describe("NOTE_TEMPLATES", () => {
  it("has at least 50 entries", () => {
    expect(NOTE_TEMPLATES.length).toBeGreaterThanOrEqual(50);
  });

  it("every entry is a valid note on its own (mín. 15 chars)", () => {
    for (const note of NOTE_TEMPLATES) {
      expect(isValidNote(note)).toBe(true);
    }
  });

  it("has no duplicate entries", () => {
    expect(new Set(NOTE_TEMPLATES).size).toBe(NOTE_TEMPLATES.length);
  });
});

describe("pickRandomNote", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the first template when Math.random returns 0", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    expect(pickRandomNote()).toBe(NOTE_TEMPLATES[0]);
  });

  it("returns the last template when Math.random returns just under 1", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999999);
    expect(pickRandomNote()).toBe(NOTE_TEMPLATES[NOTE_TEMPLATES.length - 1]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/highlights/noteTemplates.test.ts`
Expected: FAIL — `pickRandomNote` is not exported, and `NOTE_TEMPLATES.length` is 10 (below 50).

- [ ] **Step 3: Expand the pool and add `pickRandomNote`**

Replace `src/lib/highlights/noteTemplates.ts` with:

```typescript
// Starting points for the highlight note — a fixed pool sampled at random by
// pickRandomNote(), reused verbatim across many offers. This trades away
// per-offer originality for zero ongoing cost; if Amazon rejects the account
// again for "conteúdo não original", revisit with per-item AI-generated
// notes instead (see docs/superpowers/specs/2026-08-07-vitrine-automatica-design.md).
export const NOTE_TEMPLATES: string[] = [
  "Um dos mais vendidos da categoria, muito elogiado pela qualidade.",
  "Ótimo custo-benefício para quem busca praticidade no dia a dia.",
  "Um dos queridinhos do momento, muito bem avaliado por quem comprou.",
  "Excelente opção para quem quer qualidade sem gastar muito.",
  "Muito procurado ultimamente, vale a pena aproveitar o preço.",
  "Um achado e tanto para quem busca qualidade no dia a dia.",
  "Item queridinho da categoria, com ótimas avaliações.",
  "Boa pedida para quem quer praticidade sem abrir mão da qualidade.",
  "Um dos favoritos de quem já testou, custo-benefício excelente.",
  "Aproveita, esse é um item muito bem avaliado e queridinho da vez.",
  "Preço em queda agora, vale a pena ficar de olho nessa oferta.",
  "Um clássico da categoria, sempre bem avaliado por quem compra.",
  "Direto dos mais vendidos, com ótima reputação entre os compradores.",
  "Oferta que costuma sumir rápido, vale garantir logo.",
  "Item versátil, serve tanto pro dia a dia quanto de presente.",
  "Boa relação entre preço e qualidade, uma das melhores da categoria.",
  "Selecionado por ter uma boa nota média e preço competitivo agora.",
  "Sempre entre os mais procurados dessa categoria no marketplace.",
  "Vale aproveitar enquanto o preço está assim, costuma variar bastante.",
  "Um item essencial que sempre vale a pena ter por esse preço.",
  "Recomendado por quem já comprou, ótima nota nas avaliações.",
  "Uma opção sólida para quem procura esse tipo de produto agora.",
  "Custo-benefício acima da média para essa faixa de preço.",
  "Item com boa saída, sinal de que agrada bastante quem compra.",
  "Vale a pena conferir, preço bem competitivo nesse momento.",
  "Vale garantir agora, esse tipo de oferta não costuma durar muito.",
  "Um produto útil pro dia a dia, com preço abaixo do costume.",
  "Bem avaliado por quem já usa, uma boa pedida nessa faixa de preço.",
  "Oferta interessante pra quem estava de olho nesse tipo de item.",
  "Boa oportunidade pra quem procura algo assim com preço justo.",
  "Item com avaliações consistentes, uma escolha segura por esse preço.",
  "Uma das opções mais bem avaliadas da categoria no momento.",
  "Preço convidativo pra quem já tinha esse item na lista de desejos.",
  "Sempre um bom pedido dentro dessa categoria de produto.",
  "Aproveita esse preço, costuma ser bem mais caro em condições normais.",
  "Um item que vale a pena conhecer, boa reputação entre compradores.",
  "Oportunidade boa pra fechar com um preço abaixo da média.",
  "Escolha segura pra quem procura esse tipo de produto agora.",
  "Combinação boa de preço e avaliação, vale a pena considerar.",
  "Um dos itens mais buscados dessa categoria ultimamente.",
  "Preço competitivo agora, uma boa chance de garantir o produto.",
  "Produto com boa aceitação, sempre entre os mais pedidos.",
  "Vale a pena aproveitar esse preço enquanto durar o estoque.",
  "Vale a pena garantir, esse tipo de item costuma esgotar rápido.",
  "Boa opção de custo-benefício pra quem está pesquisando esse item.",
  "Item recomendado por quem já testou, avaliação bem positiva.",
  "Preço bem atrativo comparado ao que costuma ser praticado.",
  "Uma boa indicação pra quem estava esperando um preço assim.",
  "Vale ficar de olho, esse preço costuma não durar muito tempo.",
  "Produto com boa procura, sinal de que costuma valer a pena.",
];

export function pickRandomNote(): string {
  return NOTE_TEMPLATES[Math.floor(Math.random() * NOTE_TEMPLATES.length)];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/highlights/noteTemplates.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Update every place that imports `NOTE_TEMPLATES` for the dropdown**

`src/app/admin/mercadolivre/MercadoLivreAdmin.tsx`, `src/app/admin/amazon/AmazonAdmin.tsx`, and `src/app/admin/shopee/ShopeeAdmin.tsx` currently render `NOTE_TEMPLATES` as `<option>` choices in a manual note-template dropdown. Don't edit those files in this task — Tasks 13-15 remove that whole dropdown (the note is no longer written by hand). No action needed here beyond leaving the files as they are for now.

- [ ] **Step 6: Commit**

```bash
git add src/lib/highlights/noteTemplates.ts tests/lib/highlights/noteTemplates.test.ts
git commit -m "feat: expand the highlight note pool to 50 entries and add pickRandomNote"
```

---

### Task 4: `src/lib/collect/searchTerms.ts` — fixed search term pool for ML/Shopee

**Files:**
- Create: `src/lib/collect/searchTerms.ts`
- Test: `tests/collect/searchTerms.test.ts`

**Interfaces:**
- Consumes: none
- Produces: `SEARCH_TERMS: string[]`, `pickRandomSearchTerm(): string`

- [ ] **Step 1: Write the failing test**

Create `tests/collect/searchTerms.test.ts`:

```typescript
import { describe, it, expect, vi, afterEach } from "vitest";
import { SEARCH_TERMS, pickRandomSearchTerm } from "@/lib/collect/searchTerms";

describe("SEARCH_TERMS", () => {
  it("has at least 15 generic e-commerce categories", () => {
    expect(SEARCH_TERMS.length).toBeGreaterThanOrEqual(15);
  });

  it("has no duplicate or empty entries", () => {
    expect(new Set(SEARCH_TERMS).size).toBe(SEARCH_TERMS.length);
    expect(SEARCH_TERMS.every((term) => term.trim().length > 0)).toBe(true);
  });
});

describe("pickRandomSearchTerm", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the first term when Math.random returns 0", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    expect(pickRandomSearchTerm()).toBe(SEARCH_TERMS[0]);
  });

  it("returns the last term when Math.random returns just under 1", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999999);
    expect(pickRandomSearchTerm()).toBe(SEARCH_TERMS[SEARCH_TERMS.length - 1]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/collect/searchTerms.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/lib/collect/searchTerms.ts`:

```typescript
// Fixed pool of generic Brazilian e-commerce categories. Each collection
// cycle for Mercado Livre and Shopee samples one at random — editable here,
// no admin UI for this list (see docs/superpowers/specs/2026-08-07-vitrine-automatica-design.md).
export const SEARCH_TERMS: string[] = [
  "eletrônicos",
  "celular",
  "informática",
  "casa",
  "cozinha",
  "beleza",
  "moda",
  "calçados",
  "esporte",
  "brinquedos",
  "livros",
  "bebê",
  "pet",
  "ferramentas",
  "automotivo",
  "games",
  "som e áudio",
  "decoração",
  "papelaria",
  "saúde",
];

export function pickRandomSearchTerm(): string {
  return SEARCH_TERMS[Math.floor(Math.random() * SEARCH_TERMS.length)];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/collect/searchTerms.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/collect/searchTerms.ts tests/collect/searchTerms.test.ts
git commit -m "feat: add fixed search term pool for automatic ML/Shopee collection"
```

---

### Task 5: `src/lib/highlights/store.ts` — `productId`, marketplace-filtered pool, paginated/searchable public listing

**Files:**
- Modify: `src/lib/highlights/store.ts`
- Test: `tests/lib/highlights/store.test.ts` (modify existing)

**Interfaces:**
- Consumes: `Highlight`, `Marketplace` from `@prisma/client` (existing), `startOfTodayInBrazil` (Task 2)
- Produces:
  - `CreateHighlightInput` gains `productId: string`
  - `createHighlight(input: CreateHighlightInput): Promise<Highlight>` — same signature, new field
  - `listTodaysHighlights(marketplace?: Marketplace): Promise<Highlight[]>` — same name, now takes an optional marketplace filter (used by the admin pool view in Task 12/13/14/15)
  - `listHighlightsPage(input: { page: number; pageSize: number; marketplaces: Marketplace[]; q: string }): Promise<{ items: Highlight[]; hasNextPage: boolean }>` — new, used by the public vitrine (Task 16)
  - `removeHighlight`, `deleteStaleHighlights` — unchanged signatures (both already work correctly with the new 5am cutoff since they call `startOfTodayInBrazil()` internally, no code change needed in their bodies)

- [ ] **Step 1: Write the failing tests**

Replace `tests/lib/highlights/store.test.ts` with:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    highlight: {
      create: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/prisma";
import {
  createHighlight,
  listTodaysHighlights,
  listHighlightsPage,
  removeHighlight,
  deleteStaleHighlights,
} from "@/lib/highlights/store";

const BASE_INPUT = {
  marketplace: "MERCADO_LIVRE" as const,
  productId: "MLB123",
  title: "Creatina 1kg Suplemento",
  note: "Testei e recomendo, ótimo custo-benefício.",
  affiliateLink: "https://meli.la/abc",
  image: "https://img.example/1.webp",
  price: 59.9,
  oldPrice: 89.9,
  discount: 33,
};

describe("createHighlight", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("creates a row with the given data, including productId", async () => {
    vi.mocked(prisma.highlight.create).mockResolvedValue({ id: "hl1", ...BASE_INPUT } as never);

    const result = await createHighlight(BASE_INPUT);

    expect(prisma.highlight.create).toHaveBeenCalledWith({ data: BASE_INPUT });
    expect(result).toEqual({ id: "hl1", ...BASE_INPUT });
  });
});

describe("listTodaysHighlights", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-03T15:00:00.000Z")); // 12:00 in America/Sao_Paulo
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("lists all of today's rows (since the 5am cutoff), newest first, when no marketplace is given", async () => {
    vi.mocked(prisma.highlight.findMany).mockResolvedValue([] as never);

    await listTodaysHighlights();

    expect(prisma.highlight.findMany).toHaveBeenCalledWith({
      where: { createdAt: { gte: new Date("2026-08-03T08:00:00.000Z") } }, // 05:00 BRT = 08:00 UTC
      orderBy: { createdAt: "desc" },
    });
  });

  it("adds a marketplace filter when given", async () => {
    vi.mocked(prisma.highlight.findMany).mockResolvedValue([] as never);

    await listTodaysHighlights("AMAZON");

    expect(prisma.highlight.findMany).toHaveBeenCalledWith({
      where: {
        createdAt: { gte: new Date("2026-08-03T08:00:00.000Z") },
        marketplace: "AMAZON",
      },
      orderBy: { createdAt: "desc" },
    });
  });
});

describe("listHighlightsPage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-03T15:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("queries page 1 with the given page size, marketplaces and cutoff", async () => {
    vi.mocked(prisma.highlight.findMany).mockResolvedValue(
      Array.from({ length: 5 }, (_, i) => ({ id: `hl${i}` })) as never
    );

    const result = await listHighlightsPage({
      page: 1,
      pageSize: 30,
      marketplaces: ["MERCADO_LIVRE", "AMAZON", "SHOPEE"],
      q: "",
    });

    expect(prisma.highlight.findMany).toHaveBeenCalledWith({
      where: {
        createdAt: { gte: new Date("2026-08-03T08:00:00.000Z") },
        marketplace: { in: ["MERCADO_LIVRE", "AMAZON", "SHOPEE"] },
      },
      orderBy: { createdAt: "desc" },
      skip: 0,
      take: 31,
    });
    expect(result).toEqual({ items: expect.any(Array), hasNextPage: false });
    expect(result.items).toHaveLength(5);
  });

  it("adds a case-insensitive title filter when q is given", async () => {
    vi.mocked(prisma.highlight.findMany).mockResolvedValue([] as never);

    await listHighlightsPage({ page: 1, pageSize: 30, marketplaces: ["AMAZON"], q: "fone" });

    expect(prisma.highlight.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          createdAt: { gte: new Date("2026-08-03T08:00:00.000Z") },
          marketplace: { in: ["AMAZON"] },
          title: { contains: "fone", mode: "insensitive" },
        },
      })
    );
  });

  it("skips to the right offset for page 2", async () => {
    vi.mocked(prisma.highlight.findMany).mockResolvedValue([] as never);

    await listHighlightsPage({ page: 2, pageSize: 30, marketplaces: ["AMAZON"], q: "" });

    expect(prisma.highlight.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 30, take: 31 })
    );
  });

  it("reports hasNextPage true when one extra row beyond pageSize comes back", async () => {
    vi.mocked(prisma.highlight.findMany).mockResolvedValue(
      Array.from({ length: 31 }, (_, i) => ({ id: `hl${i}` })) as never
    );

    const result = await listHighlightsPage({
      page: 1,
      pageSize: 30,
      marketplaces: ["AMAZON"],
      q: "",
    });

    expect(result.hasNextPage).toBe(true);
    expect(result.items).toHaveLength(30);
  });

  it("returns an empty page with no marketplaces selected, without erroring", async () => {
    vi.mocked(prisma.highlight.findMany).mockResolvedValue([] as never);

    const result = await listHighlightsPage({ page: 1, pageSize: 30, marketplaces: [], q: "" });

    expect(prisma.highlight.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ marketplace: { in: [] } }) })
    );
    expect(result).toEqual({ items: [], hasNextPage: false });
  });
});

describe("removeHighlight", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("deletes the row by id", async () => {
    vi.mocked(prisma.highlight.deleteMany).mockResolvedValue({ count: 1 } as never);

    await removeHighlight("hl1");

    expect(prisma.highlight.deleteMany).toHaveBeenCalledWith({ where: { id: "hl1" } });
  });

  it("does not throw when the id does not exist", async () => {
    vi.mocked(prisma.highlight.deleteMany).mockResolvedValue({ count: 0 } as never);

    await expect(removeHighlight("missing")).resolves.toBeUndefined();
  });
});

describe("deleteStaleHighlights", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-03T15:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("deletes rows created before today's 5am cutoff in America/Sao_Paulo", async () => {
    vi.mocked(prisma.highlight.deleteMany).mockResolvedValue({ count: 7 } as never);

    const count = await deleteStaleHighlights();

    expect(prisma.highlight.deleteMany).toHaveBeenCalledWith({
      where: { createdAt: { lt: new Date("2026-08-03T08:00:00.000Z") } },
    });
    expect(count).toBe(7);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/highlights/store.test.ts`
Expected: FAIL — `listHighlightsPage` not exported; `listTodaysHighlights`/`createHighlight` shapes don't match yet; `select` clause in the old implementation makes the "no marketplace" assertion fail too.

- [ ] **Step 3: Rewrite the implementation**

Replace `src/lib/highlights/store.ts` with:

```typescript
import type { Highlight, Marketplace } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { startOfTodayInBrazil } from "@/lib/date";

export type CreateHighlightInput = {
  marketplace: Marketplace;
  productId: string;
  title: string;
  note: string;
  affiliateLink: string;
  image: string;
  price: number;
  oldPrice: number | null;
  discount: number | null;
};

export async function createHighlight(input: CreateHighlightInput): Promise<Highlight> {
  return prisma.highlight.create({ data: input });
}

export async function listTodaysHighlights(marketplace?: Marketplace): Promise<Highlight[]> {
  return prisma.highlight.findMany({
    where: {
      createdAt: { gte: startOfTodayInBrazil() },
      ...(marketplace ? { marketplace } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
}

export type ListHighlightsPageInput = {
  page: number;
  pageSize: number;
  marketplaces: Marketplace[];
  q: string;
};

export type ListHighlightsPageResult = {
  items: Highlight[];
  hasNextPage: boolean;
};

export async function listHighlightsPage(
  input: ListHighlightsPageInput
): Promise<ListHighlightsPageResult> {
  const { page, pageSize, marketplaces, q } = input;
  const trimmedQuery = q.trim();

  const rows = await prisma.highlight.findMany({
    where: {
      createdAt: { gte: startOfTodayInBrazil() },
      marketplace: { in: marketplaces },
      ...(trimmedQuery ? { title: { contains: trimmedQuery, mode: "insensitive" as const } } : {}),
    },
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * pageSize,
    take: pageSize + 1,
  });

  return { items: rows.slice(0, pageSize), hasNextPage: rows.length > pageSize };
}

export async function removeHighlight(id: string): Promise<void> {
  await prisma.highlight.deleteMany({ where: { id } });
}

export async function deleteStaleHighlights(): Promise<number> {
  const result = await prisma.highlight.deleteMany({
    where: { createdAt: { lt: startOfTodayInBrazil() } },
  });
  return result.count;
}
```

Note the dropped `select` clause on `listTodaysHighlights`: the field allowlist it used to enforce (keeping a future internal-only column off the public vitrine) is no longer needed here, because `listTodaysHighlights` is now an **admin-only** helper (used by the hub pool view, Task 12) — the public page uses `listHighlightsPage` instead, which returns full rows too, but only ever renders the fields `VitrineHighlights.tsx` already destructures. Every current `Highlight` field (`id`, `marketplace`, `productId`, `title`, `affiliateLink`, `image`, `price`, `oldPrice`, `discount`, `note`, `createdAt`) is safe to expose publicly — none of them are internal.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/highlights/store.test.ts`
Expected: PASS, all tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/highlights/store.ts tests/lib/highlights/store.test.ts
git commit -m "feat: add productId to highlights, marketplace pool filter, and paginated/searchable listing"
```

---

### Task 6: `src/lib/collect/types.ts` + `src/lib/collect/persist.ts` — shared collect types, `persistItems`, `findHighlightsByProductIds`

**Files:**
- Create: `src/lib/collect/types.ts`
- Create: `src/lib/collect/persist.ts`
- Test: `tests/collect/persist.test.ts`

**Interfaces:**
- Consumes: `pickRandomNote` (Task 3), `prisma` (existing `@/lib/prisma`), `Marketplace`/`Highlight` from `@prisma/client`
- Produces:
  - `CollectItem = { productId: string; title: string; affiliateLink: string; image: string; price: number; oldPrice: number | null; discount: number | null }`
  - `CollectResult = { attempted: number; inserted: number; skipped: number; error?: string }`
  - `persistItems(marketplace: Marketplace, items: CollectItem[]): Promise<{ inserted: number; skipped: number }>`
  - `findHighlightsByProductIds(marketplace: Marketplace, productIds: string[]): Promise<Highlight[]>`

- [ ] **Step 1: Write the failing test**

Create `tests/collect/persist.test.ts`:

```typescript
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    highlight: {
      createMany: vi.fn(),
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
    vi.mocked(prisma.highlight.createMany).mockResolvedValue({ count: 1 } as never);

    const result = await persistItems("MERCADO_LIVRE", [ITEM, { ...ITEM, productId: "MLB2", image: "" }]);

    expect(prisma.highlight.createMany).toHaveBeenCalledWith({
      data: [
        {
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
      ],
      skipDuplicates: true,
    });
    expect(result).toEqual({ inserted: 1, skipped: 1 });
  });

  it("drops items with a non-positive price before writing", async () => {
    vi.mocked(prisma.highlight.createMany).mockResolvedValue({ count: 0 } as never);

    const result = await persistItems("AMAZON", [{ ...ITEM, price: 0 }]);

    expect(prisma.highlight.createMany).not.toHaveBeenCalled();
    expect(result).toEqual({ inserted: 0, skipped: 1 });
  });

  it("counts duplicates skipped by the database as skipped", async () => {
    vi.mocked(prisma.highlight.createMany).mockResolvedValue({ count: 1 } as never);

    const result = await persistItems("SHOPEE", [ITEM, { ...ITEM, productId: "MLB2" }]);

    expect(result).toEqual({ inserted: 1, skipped: 1 });
  });

  it("returns zero/zero for an empty item list without calling the database", async () => {
    const result = await persistItems("AMAZON", []);

    expect(prisma.highlight.createMany).not.toHaveBeenCalled();
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

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/collect/persist.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the implementation**

Create `src/lib/collect/types.ts`:

```typescript
export type CollectItem = {
  productId: string;
  title: string;
  affiliateLink: string;
  image: string;
  price: number;
  oldPrice: number | null;
  discount: number | null;
};

export type CollectResult = {
  attempted: number;
  inserted: number;
  skipped: number;
  error?: string;
};
```

Create `src/lib/collect/persist.ts`:

```typescript
import type { Highlight, Marketplace } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { pickRandomNote } from "@/lib/highlights/noteTemplates";
import type { CollectItem } from "@/lib/collect/types";

export async function persistItems(
  marketplace: Marketplace,
  items: CollectItem[]
): Promise<{ inserted: number; skipped: number }> {
  const valid = items.filter((item) => item.image.length > 0 && item.price > 0);
  if (valid.length === 0) {
    return { inserted: 0, skipped: items.length };
  }

  const result = await prisma.highlight.createMany({
    data: valid.map((item) => ({
      marketplace,
      productId: item.productId,
      title: item.title,
      affiliateLink: item.affiliateLink,
      image: item.image,
      price: item.price,
      oldPrice: item.oldPrice,
      discount: item.discount,
      note: pickRandomNote(),
    })),
    skipDuplicates: true,
  });

  return { inserted: result.count, skipped: items.length - result.count };
}

export async function findHighlightsByProductIds(
  marketplace: Marketplace,
  productIds: string[]
): Promise<Highlight[]> {
  if (productIds.length === 0) {
    return [];
  }
  return prisma.highlight.findMany({
    where: { marketplace, productId: { in: productIds } },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/collect/persist.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/collect/types.ts src/lib/collect/persist.ts tests/collect/persist.test.ts
git commit -m "feat: add shared collect item persistence with quality filter and dedup"
```

---

### Task 7: Remove the manual "Gerar link" flow — trim `createLink.ts`, delete the `generate-link` route

**Files:**
- Modify: `src/lib/mercadolivre/createLink.ts`
- Modify: `tests/mercadolivre/createLink.test.ts`
- Delete: `src/app/api/admin/mercadolivre/generate-link/route.ts`
- Delete: `tests/api/admin/mercadolivre/generate-link.test.ts`
- Modify: `src/app/api/admin/mercadolivre/search/route.ts`

**Interfaces:**
- Consumes: none new
- Produces: `createAffiliateLink(url, session): Promise<AffiliateLinkResult>` — unchanged, still exported (Task 8's `collectMercadoLivre` needs it). `recordGeneratedLink`, `wasGeneratedToday`, `findGeneratedTodayMap` — removed, no longer exported (they existed only to dedup the old manual "Gerar link" button against `MercadoLivreGeneratedLink`, which Task 1 already dropped from the schema).

- [ ] **Step 1: Trim `createLink.ts`**

Replace `src/lib/mercadolivre/createLink.ts` with:

```typescript
import type { MLHubSession } from "@/lib/mercadolivre/session";
import { MercadoLivreSessionExpiredError, BROWSER_LIKE_HEADERS } from "@/lib/mercadolivre/hubClient";

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
      ...BROWSER_LIKE_HEADERS,
      "content-type": "application/json",
      accept: "application/json, text/plain, */*",
      origin: "https://www.mercadolivre.com.br",
      referer: "https://www.mercadolivre.com.br/afiliados/linkbuilder",
      cookie: session.cookieHeader,
      "x-csrf-token": session.csrfToken,
    },
    body: JSON.stringify({ urls: [url], tag: process.env.ML_AFFILIATE_WORD ?? "" }),
    signal: AbortSignal.timeout(10_000),
  });

  if (response.status === 401 || response.status === 403) {
    console.error(`Mercado Livre createLink rejected the session: HTTP ${response.status}`);
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
```

- [ ] **Step 2: Trim its test**

In `tests/mercadolivre/createLink.test.ts`, delete the `recordGeneratedLink`, `wasGeneratedToday`, and `findGeneratedTodayMap` describe blocks (everything from `describe("recordGeneratedLink"` to the end of the file), and remove those three names from the top `import { ... } from "@/lib/mercadolivre/createLink"` line, and delete the whole `vi.mock("@/lib/prisma", ...)` block plus the `import { prisma } from "@/lib/prisma";` line (nothing left in the file touches Prisma). The file should end right after the `createAffiliateLink` describe block's closing `});`.

- [ ] **Step 3: Delete the generate-link route and its test**

```bash
rm -rf src/app/api/admin/mercadolivre/generate-link
rm tests/api/admin/mercadolivre/generate-link.test.ts
```

- [ ] **Step 4: Drop `findGeneratedTodayMap` usage from the search route**

Replace `src/app/api/admin/mercadolivre/search/route.ts` with:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/mercadolivre/session";
import { searchAffiliateProducts, MercadoLivreSessionExpiredError } from "@/lib/mercadolivre/hubClient";
import { isAuthorizedAdminRequest } from "@/lib/adminSession";

export async function GET(request: NextRequest) {
  if (!isAuthorizedAdminRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const query = request.nextUrl.searchParams.get("q") ?? "";
  const rawOffset = Number(request.nextUrl.searchParams.get("offset"));
  const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? rawOffset : 0;

  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "session_expired" }, { status: 401 });
  }

  try {
    const items = await searchAffiliateProducts(query, session, offset);
    return NextResponse.json({ items });
  } catch (error) {
    if (error instanceof MercadoLivreSessionExpiredError) {
      return NextResponse.json({ error: "session_expired" }, { status: 401 });
    }
    console.error("Mercado Livre hub search failed:", error);
    return NextResponse.json({ error: "search_failed" }, { status: 502 });
  }
}
```

This is a checkpoint, not the final shape of this route — Task 14 rewrites it again to write through `persistItems` and return pool rows. Keeping it working (just without `generatedLink`) here keeps every task independently green.

- [ ] **Step 5: Update that route's existing test**

Find and open `tests/api/admin/mercadolivre/search.test.ts`. Remove any assertion referencing `findGeneratedTodayMap` or a `generatedLink` field in the response body (mirror whatever the current file asserts — the response body is now just `{ items }` where each item is a plain `MLHubItem`, no `generatedLink` key). Also remove the `vi.mock("@/lib/mercadolivre/createLink", ...)` block if the file has one, since the route no longer imports from that module.

- [ ] **Step 6: Run the affected tests**

Run: `npx vitest run tests/mercadolivre/createLink.test.ts tests/api/admin/mercadolivre/search.test.ts`
Expected: PASS. Also confirm the deleted route's test is gone: `npx vitest run tests/api/admin/mercadolivre/generate-link.test.ts` should now fail with "no test files found" (proving the file was actually deleted, not just skipped).

- [ ] **Step 7: Commit**

```bash
git add src/lib/mercadolivre/createLink.ts tests/mercadolivre/createLink.test.ts \
  src/app/api/admin/mercadolivre/search/route.ts tests/api/admin/mercadolivre/search.test.ts
git rm -r src/app/api/admin/mercadolivre/generate-link tests/api/admin/mercadolivre/generate-link.test.ts
git commit -m "refactor: drop the manual ML link-generation flow, now handled by the collector"
```

---

### Task 8: `src/lib/collect/mercadolivre.ts` — `mapMercadoLivreItems` + `collectMercadoLivre`

**Files:**
- Create: `src/lib/collect/mercadolivre.ts`
- Test: `tests/collect/mercadolivre.test.ts`

**Interfaces:**
- Consumes: `getSession` from `@/lib/mercadolivre/session` (existing), `searchAffiliateProducts`, `MercadoLivreSessionExpiredError`, `MLHubItem` from `@/lib/mercadolivre/hubClient` (existing), `createAffiliateLink` from `@/lib/mercadolivre/createLink` (Task 7), `parseDiscountPercentage` from `@/lib/mercadolivre/discountLabel` (existing), `persistItems` from `@/lib/collect/persist` (Task 6), `pickRandomSearchTerm` from `@/lib/collect/searchTerms` (Task 4), `prisma` from `@/lib/prisma` (existing), `CollectItem`/`CollectResult` from `@/lib/collect/types` (Task 6)
- Produces: `mapMercadoLivreItems(items: MLHubItem[], session: MLHubSession): Promise<CollectItem[]>` (skips items already pooled today for ML, calls `createAffiliateLink` only for the rest — this is the network-cost-avoidance step called out in the spec), `collectMercadoLivre(term?: string): Promise<CollectResult>`

- [ ] **Step 1: Write the failing test**

Create `tests/collect/mercadolivre.test.ts`:

```typescript
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/mercadolivre/session", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/mercadolivre/hubClient", async () => {
  const actual = await vi.importActual("@/lib/mercadolivre/hubClient");
  return { ...actual, searchAffiliateProducts: vi.fn() };
});
vi.mock("@/lib/mercadolivre/createLink", () => ({ createAffiliateLink: vi.fn() }));
vi.mock("@/lib/collect/persist", () => ({ persistItems: vi.fn() }));
vi.mock("@/lib/collect/searchTerms", () => ({ pickRandomSearchTerm: vi.fn().mockReturnValue("eletrônicos") }));
vi.mock("@/lib/prisma", () => ({ prisma: { highlight: { findMany: vi.fn() } } }));

import { getSession } from "@/lib/mercadolivre/session";
import {
  searchAffiliateProducts,
  MercadoLivreSessionExpiredError,
  type MLHubItem,
} from "@/lib/mercadolivre/hubClient";
import { createAffiliateLink } from "@/lib/mercadolivre/createLink";
import { persistItems } from "@/lib/collect/persist";
import { prisma } from "@/lib/prisma";
import { mapMercadoLivreItems, collectMercadoLivre } from "@/lib/collect/mercadolivre";

const session = { cookieHeader: "a=b", csrfToken: "tok" };

function buildItem(overrides: Partial<MLHubItem> = {}): MLHubItem {
  return {
    itemId: "MLB1",
    title: "Creatina 1kg",
    price: 59.9,
    oldPrice: 89.9,
    discountLabel: "33% OFF",
    rating: 4.8,
    soldLabel: "+500 vendidos",
    image: "https://img.example/1.webp",
    permalink: "https://www.mercadolivre.com.br/p/MLB1",
    commissionLabel: "25%",
    ...overrides,
  };
}

describe("mapMercadoLivreItems", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns an empty array without querying the database for an empty input", async () => {
    const result = await mapMercadoLivreItems([], session);

    expect(prisma.highlight.findMany).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it("calls createAffiliateLink only for items not already pooled today", async () => {
    vi.mocked(prisma.highlight.findMany).mockResolvedValue([{ productId: "MLB1" }] as never);
    vi.mocked(createAffiliateLink).mockResolvedValue({
      shortUrl: "https://meli.la/xyz",
      longUrl: "https://www.mercadolivre.com.br/social/...",
    });

    const items = [buildItem({ itemId: "MLB1" }), buildItem({ itemId: "MLB2", permalink: "https://ml.com/MLB2" })];
    const result = await mapMercadoLivreItems(items, session);

    expect(prisma.highlight.findMany).toHaveBeenCalledWith({
      where: { marketplace: "MERCADO_LIVRE", productId: { in: ["MLB1", "MLB2"] } },
      select: { productId: true },
    });
    expect(createAffiliateLink).toHaveBeenCalledTimes(1);
    expect(createAffiliateLink).toHaveBeenCalledWith("https://ml.com/MLB2", session);
    expect(result).toEqual([
      {
        productId: "MLB2",
        title: "Creatina 1kg",
        affiliateLink: "https://meli.la/xyz",
        image: "https://img.example/1.webp",
        price: 59.9,
        oldPrice: 89.9,
        discount: 33,
      },
    ]);
  });

  it("propagates MercadoLivreSessionExpiredError from createAffiliateLink", async () => {
    vi.mocked(prisma.highlight.findMany).mockResolvedValue([] as never);
    vi.mocked(createAffiliateLink).mockRejectedValue(new MercadoLivreSessionExpiredError());

    await expect(mapMercadoLivreItems([buildItem()], session)).rejects.toThrow(
      MercadoLivreSessionExpiredError
    );
  });
});

describe("collectMercadoLivre", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns a no_session error without fetching when there's no saved session", async () => {
    vi.mocked(getSession).mockResolvedValue(null);

    const result = await collectMercadoLivre();

    expect(searchAffiliateProducts).not.toHaveBeenCalled();
    expect(result).toEqual({ attempted: 0, inserted: 0, skipped: 0, error: "no_session" });
  });

  it("uses the given term instead of sampling one when a term is provided", async () => {
    vi.mocked(getSession).mockResolvedValue(session);
    vi.mocked(searchAffiliateProducts).mockResolvedValue([]);

    await collectMercadoLivre("air fryer");

    expect(searchAffiliateProducts).toHaveBeenCalledWith("air fryer", session, 0);
  });

  it("samples a random term when none is given", async () => {
    vi.mocked(getSession).mockResolvedValue(session);
    vi.mocked(searchAffiliateProducts).mockResolvedValue([]);

    await collectMercadoLivre();

    expect(searchAffiliateProducts).toHaveBeenCalledWith("eletrônicos", session, 0);
  });

  it("pages until it has 50 items, then stops requesting more", async () => {
    vi.mocked(getSession).mockResolvedValue(session);
    vi.mocked(prisma.highlight.findMany).mockResolvedValue([] as never);
    vi.mocked(createAffiliateLink).mockResolvedValue({ shortUrl: "https://meli.la/x", longUrl: "https://ml.com" });
    vi.mocked(searchAffiliateProducts)
      .mockResolvedValueOnce(Array.from({ length: 30 }, (_, i) => buildItem({ itemId: `MLB${i}` })))
      .mockResolvedValueOnce(Array.from({ length: 30 }, (_, i) => buildItem({ itemId: `MLB${30 + i}` })));
    vi.mocked(persistItems).mockResolvedValue({ inserted: 50, skipped: 0 });

    const result = await collectMercadoLivre("eletrônicos");

    expect(searchAffiliateProducts).toHaveBeenCalledTimes(2);
    expect(searchAffiliateProducts).toHaveBeenNthCalledWith(1, "eletrônicos", session, 0);
    expect(searchAffiliateProducts).toHaveBeenNthCalledWith(2, "eletrônicos", session, 30);
    expect(result.attempted).toBe(50);
  });

  it("stops paging when a page comes back empty", async () => {
    vi.mocked(getSession).mockResolvedValue(session);
    vi.mocked(searchAffiliateProducts).mockResolvedValue([]);

    const result = await collectMercadoLivre("eletrônicos");

    expect(searchAffiliateProducts).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ attempted: 0, inserted: 0, skipped: 0 });
  });

  it("persists the mapped items and returns the counts from persistItems", async () => {
    vi.mocked(getSession).mockResolvedValue(session);
    vi.mocked(prisma.highlight.findMany).mockResolvedValue([] as never);
    vi.mocked(searchAffiliateProducts).mockResolvedValueOnce([buildItem()]).mockResolvedValueOnce([]);
    vi.mocked(createAffiliateLink).mockResolvedValue({ shortUrl: "https://meli.la/x", longUrl: "https://ml.com" });
    vi.mocked(persistItems).mockResolvedValue({ inserted: 1, skipped: 0 });

    const result = await collectMercadoLivre("eletrônicos");

    expect(persistItems).toHaveBeenCalledWith("MERCADO_LIVRE", [
      expect.objectContaining({ productId: "MLB1", affiliateLink: "https://meli.la/x" }),
    ]);
    expect(result).toEqual({ attempted: 1, inserted: 1, skipped: 0 });
  });

  it("returns a session_expired error without throwing when the session expires mid-run", async () => {
    vi.mocked(getSession).mockResolvedValue(session);
    vi.mocked(searchAffiliateProducts).mockResolvedValueOnce([buildItem()]);
    vi.mocked(prisma.highlight.findMany).mockResolvedValue([] as never);
    vi.mocked(createAffiliateLink).mockRejectedValue(new MercadoLivreSessionExpiredError());

    const result = await collectMercadoLivre("eletrônicos");

    expect(result).toEqual({ attempted: 0, inserted: 0, skipped: 0, error: "session_expired" });
  });

  it("returns a collect_failed error without throwing on any other error", async () => {
    vi.mocked(getSession).mockResolvedValue(session);
    vi.mocked(searchAffiliateProducts).mockRejectedValue(new Error("boom"));

    const result = await collectMercadoLivre("eletrônicos");

    expect(result).toEqual({ attempted: 0, inserted: 0, skipped: 0, error: "collect_failed" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/collect/mercadolivre.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/lib/collect/mercadolivre.ts`:

```typescript
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/mercadolivre/session";
import type { MLHubSession } from "@/lib/mercadolivre/session";
import {
  searchAffiliateProducts,
  MercadoLivreSessionExpiredError,
  type MLHubItem,
} from "@/lib/mercadolivre/hubClient";
import { createAffiliateLink } from "@/lib/mercadolivre/createLink";
import { parseDiscountPercentage } from "@/lib/mercadolivre/discountLabel";
import { persistItems } from "@/lib/collect/persist";
import { pickRandomSearchTerm } from "@/lib/collect/searchTerms";
import type { CollectItem, CollectResult } from "@/lib/collect/types";

const TARGET_ITEM_COUNT = 50;

// Mercado Livre's hub search doesn't return an affiliate link — generating
// one costs a network call (createLink), so items already pooled today are
// skipped before spending that call, not just before the final write.
export async function mapMercadoLivreItems(
  items: MLHubItem[],
  session: MLHubSession
): Promise<CollectItem[]> {
  if (items.length === 0) {
    return [];
  }

  const existing = await prisma.highlight.findMany({
    where: { marketplace: "MERCADO_LIVRE", productId: { in: items.map((item) => item.itemId) } },
    select: { productId: true },
  });
  const existingIds = new Set(existing.map((row) => row.productId));

  const results: CollectItem[] = [];
  for (const item of items) {
    if (existingIds.has(item.itemId)) {
      continue;
    }
    const { shortUrl } = await createAffiliateLink(item.permalink, session);
    results.push({
      productId: item.itemId,
      title: item.title,
      affiliateLink: shortUrl,
      image: item.image,
      price: item.price,
      oldPrice: item.oldPrice,
      discount: parseDiscountPercentage(item.discountLabel),
    });
  }
  return results;
}

export async function collectMercadoLivre(term?: string): Promise<CollectResult> {
  const session = await getSession();
  if (!session) {
    return { attempted: 0, inserted: 0, skipped: 0, error: "no_session" };
  }

  const searchTerm = term ?? pickRandomSearchTerm();

  try {
    const fetched: MLHubItem[] = [];
    let offset = 0;
    while (fetched.length < TARGET_ITEM_COUNT) {
      const page = await searchAffiliateProducts(searchTerm, session, offset);
      if (page.length === 0) {
        break;
      }
      fetched.push(...page);
      offset += page.length;
    }
    const items = fetched.slice(0, TARGET_ITEM_COUNT);

    if (items.length === 0) {
      return { attempted: 0, inserted: 0, skipped: 0 };
    }

    const mapped = await mapMercadoLivreItems(items, session);
    const { inserted, skipped } = await persistItems("MERCADO_LIVRE", mapped);
    return { attempted: items.length, inserted, skipped: skipped + (items.length - mapped.length) };
  } catch (error) {
    if (error instanceof MercadoLivreSessionExpiredError) {
      return { attempted: 0, inserted: 0, skipped: 0, error: "session_expired" };
    }
    console.error("collectMercadoLivre failed:", error);
    return { attempted: 0, inserted: 0, skipped: 0, error: "collect_failed" };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/collect/mercadolivre.test.ts`
Expected: PASS, all tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/collect/mercadolivre.ts tests/collect/mercadolivre.test.ts
git commit -m "feat: add Mercado Livre automatic collector"
```

---

### Task 9: `src/lib/collect/amazon.ts` — `mapAmazonItems` + `collectAmazon`

**Files:**
- Create: `src/lib/collect/amazon.ts`
- Test: `tests/collect/amazon.test.ts`

**Interfaces:**
- Consumes: `getSession` from `@/lib/amazon/session` (existing), `listDeals`, `AmazonSessionExpiredError`, `AmazonDealItem` from `@/lib/amazon/hubClient` (existing — note `AmazonDealItem` already has a ready-to-use `affiliateLink`, no network call needed to build it), `parseDiscountPercentage` from `@/lib/mercadolivre/discountLabel` (existing, reused as-is per the spec), `persistItems` from `@/lib/collect/persist` (Task 6), `CollectItem`/`CollectResult` from `@/lib/collect/types` (Task 6)
- Produces: `mapAmazonItems(items: AmazonDealItem[]): CollectItem[]` (pure, synchronous — no network cost to avoid here, unlike ML), `collectAmazon(): Promise<CollectResult>`

- [ ] **Step 1: Write the failing test**

Create `tests/collect/amazon.test.ts`:

```typescript
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/amazon/session", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/amazon/hubClient", async () => {
  const actual = await vi.importActual("@/lib/amazon/hubClient");
  return { ...actual, listDeals: vi.fn() };
});
vi.mock("@/lib/collect/persist", () => ({ persistItems: vi.fn() }));

import { getSession } from "@/lib/amazon/session";
import { listDeals, AmazonSessionExpiredError, type AmazonDealItem } from "@/lib/amazon/hubClient";
import { persistItems } from "@/lib/collect/persist";
import { mapAmazonItems, collectAmazon } from "@/lib/collect/amazon";

const session = { cookieHeader: "a=b" };

function buildItem(overrides: Partial<AmazonDealItem> = {}): AmazonDealItem {
  return {
    asin: "B01",
    title: "Fone Bluetooth",
    price: 129.9,
    oldPrice: 199.9,
    discountLabel: "35% off",
    image: "https://img.example/1.jpg",
    permalink: "https://www.amazon.com.br/dp/B01",
    affiliateLink: "https://www.amazon.com.br/dp/B01?tag=bonsachados0f-20",
    ...overrides,
  };
}

describe("mapAmazonItems", () => {
  it("maps fields and parses the discount label into a number", () => {
    const result = mapAmazonItems([buildItem()]);

    expect(result).toEqual([
      {
        productId: "B01",
        title: "Fone Bluetooth",
        affiliateLink: "https://www.amazon.com.br/dp/B01?tag=bonsachados0f-20",
        image: "https://img.example/1.jpg",
        price: 129.9,
        oldPrice: 199.9,
        discount: 35,
      },
    ]);
  });

  it("maps a null discountLabel to a null discount", () => {
    const result = mapAmazonItems([buildItem({ discountLabel: null })]);

    expect(result[0].discount).toBeNull();
  });
});

describe("collectAmazon", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns a no_session error without fetching when there's no saved session", async () => {
    vi.mocked(getSession).mockResolvedValue(null);

    const result = await collectAmazon();

    expect(listDeals).not.toHaveBeenCalled();
    expect(result).toEqual({ attempted: 0, inserted: 0, skipped: 0, error: "no_session" });
  });

  it("pages until it has 50 items using the API's own nextIndex", async () => {
    vi.mocked(getSession).mockResolvedValue(session);
    vi.mocked(listDeals)
      .mockResolvedValueOnce({
        items: Array.from({ length: 30 }, (_, i) => buildItem({ asin: `B${i}` })),
        nextIndex: 30,
      })
      .mockResolvedValueOnce({
        items: Array.from({ length: 30 }, (_, i) => buildItem({ asin: `B${30 + i}` })),
        nextIndex: 60,
      });
    vi.mocked(persistItems).mockResolvedValue({ inserted: 50, skipped: 0 });

    const result = await collectAmazon();

    expect(listDeals).toHaveBeenCalledTimes(2);
    expect(listDeals).toHaveBeenNthCalledWith(1, 0, session);
    expect(listDeals).toHaveBeenNthCalledWith(2, 30, session);
    expect(result.attempted).toBe(50);
  });

  it("stops paging when nextIndex is null", async () => {
    vi.mocked(getSession).mockResolvedValue(session);
    vi.mocked(listDeals).mockResolvedValue({ items: [buildItem()], nextIndex: null });
    vi.mocked(persistItems).mockResolvedValue({ inserted: 1, skipped: 0 });

    const result = await collectAmazon();

    expect(listDeals).toHaveBeenCalledTimes(1);
    expect(result.attempted).toBe(1);
  });

  it("persists the mapped items and returns the counts from persistItems", async () => {
    vi.mocked(getSession).mockResolvedValue(session);
    vi.mocked(listDeals).mockResolvedValue({ items: [buildItem()], nextIndex: null });
    vi.mocked(persistItems).mockResolvedValue({ inserted: 1, skipped: 0 });

    const result = await collectAmazon();

    expect(persistItems).toHaveBeenCalledWith("AMAZON", [expect.objectContaining({ productId: "B01" })]);
    expect(result).toEqual({ attempted: 1, inserted: 1, skipped: 0 });
  });

  it("returns a session_expired error without throwing when the session has expired", async () => {
    vi.mocked(getSession).mockResolvedValue(session);
    vi.mocked(listDeals).mockRejectedValue(new AmazonSessionExpiredError());

    const result = await collectAmazon();

    expect(result).toEqual({ attempted: 0, inserted: 0, skipped: 0, error: "session_expired" });
  });

  it("returns a collect_failed error without throwing on any other error", async () => {
    vi.mocked(getSession).mockResolvedValue(session);
    vi.mocked(listDeals).mockRejectedValue(new Error("boom"));

    const result = await collectAmazon();

    expect(result).toEqual({ attempted: 0, inserted: 0, skipped: 0, error: "collect_failed" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/collect/amazon.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/lib/collect/amazon.ts`:

```typescript
import { getSession } from "@/lib/amazon/session";
import { listDeals, AmazonSessionExpiredError, type AmazonDealItem } from "@/lib/amazon/hubClient";
import { parseDiscountPercentage } from "@/lib/mercadolivre/discountLabel";
import { persistItems } from "@/lib/collect/persist";
import type { CollectItem, CollectResult } from "@/lib/collect/types";

const TARGET_ITEM_COUNT = 50;

export function mapAmazonItems(items: AmazonDealItem[]): CollectItem[] {
  return items.map((item) => ({
    productId: item.asin,
    title: item.title,
    affiliateLink: item.affiliateLink,
    image: item.image,
    price: item.price,
    oldPrice: item.oldPrice,
    discount: parseDiscountPercentage(item.discountLabel),
  }));
}

export async function collectAmazon(): Promise<CollectResult> {
  const session = await getSession();
  if (!session) {
    return { attempted: 0, inserted: 0, skipped: 0, error: "no_session" };
  }

  try {
    const fetched: AmazonDealItem[] = [];
    let offset = 0;
    let nextIndex: number | null = 0;
    while (fetched.length < TARGET_ITEM_COUNT && nextIndex !== null) {
      const page = await listDeals(offset, session);
      if (page.items.length === 0) {
        break;
      }
      fetched.push(...page.items);
      nextIndex = page.nextIndex;
      offset = page.nextIndex ?? offset;
    }
    const items = fetched.slice(0, TARGET_ITEM_COUNT);

    if (items.length === 0) {
      return { attempted: 0, inserted: 0, skipped: 0 };
    }

    const mapped = mapAmazonItems(items);
    const { inserted, skipped } = await persistItems("AMAZON", mapped);
    return { attempted: items.length, inserted, skipped };
  } catch (error) {
    if (error instanceof AmazonSessionExpiredError) {
      return { attempted: 0, inserted: 0, skipped: 0, error: "session_expired" };
    }
    console.error("collectAmazon failed:", error);
    return { attempted: 0, inserted: 0, skipped: 0, error: "collect_failed" };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/collect/amazon.test.ts`
Expected: PASS, all tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/collect/amazon.ts tests/collect/amazon.test.ts
git commit -m "feat: add Amazon automatic collector"
```

---

### Task 10: `src/lib/collect/shopee.ts` — `mapShopeeItems` + `collectShopee`

**Files:**
- Create: `src/lib/collect/shopee.ts`
- Test: `tests/collect/shopee.test.ts`

**Interfaces:**
- Consumes: `searchProducts`, `ShopeeHubItem` from `@/lib/shopee/hubClient` (existing — no session concept, API-key based), `persistItems` from `@/lib/collect/persist` (Task 6), `pickRandomSearchTerm` from `@/lib/collect/searchTerms` (Task 4), `CollectItem`/`CollectResult` from `@/lib/collect/types` (Task 6)
- Produces: `mapShopeeItems(items: ShopeeHubItem[]): CollectItem[]` (pure — `discount` is already numeric from the Shopee API, no parsing needed; `oldPrice` is always `null`, same as the existing manual flow), `collectShopee(term?: string): Promise<CollectResult>`

- [ ] **Step 1: Write the failing test**

Create `tests/collect/shopee.test.ts`:

```typescript
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/shopee/hubClient", () => ({ searchProducts: vi.fn() }));
vi.mock("@/lib/collect/persist", () => ({ persistItems: vi.fn() }));
vi.mock("@/lib/collect/searchTerms", () => ({ pickRandomSearchTerm: vi.fn().mockReturnValue("eletrônicos") }));

import { searchProducts, type ShopeeHubItem } from "@/lib/shopee/hubClient";
import { persistItems } from "@/lib/collect/persist";
import { mapShopeeItems, collectShopee } from "@/lib/collect/shopee";

function buildItem(overrides: Partial<ShopeeHubItem> = {}): ShopeeHubItem {
  return {
    itemId: "SP1",
    title: "Air Fryer 4L",
    price: 219.9,
    discount: 20,
    image: "https://img.example/2.jpg",
    affiliateLink: "https://s.shopee.com.br/abc",
    productLink: "https://shopee.com.br/product/1/2",
    shopName: "Loja X",
    commissionRate: "0.05",
    ratingStar: 4.7,
    ...overrides,
  };
}

describe("mapShopeeItems", () => {
  it("maps fields, always with a null oldPrice", () => {
    const result = mapShopeeItems([buildItem()]);

    expect(result).toEqual([
      {
        productId: "SP1",
        title: "Air Fryer 4L",
        affiliateLink: "https://s.shopee.com.br/abc",
        image: "https://img.example/2.jpg",
        price: 219.9,
        oldPrice: null,
        discount: 20,
      },
    ]);
  });
});

describe("collectShopee", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("samples a random term when none is given", async () => {
    vi.mocked(searchProducts).mockResolvedValue({ items: [], hasNextPage: false });

    await collectShopee();

    expect(searchProducts).toHaveBeenCalledWith("eletrônicos", 1);
  });

  it("uses the given term instead of sampling one", async () => {
    vi.mocked(searchProducts).mockResolvedValue({ items: [], hasNextPage: false });

    await collectShopee("air fryer");

    expect(searchProducts).toHaveBeenCalledWith("air fryer", 1);
  });

  it("pages until it has 50 items or hasNextPage is false", async () => {
    vi.mocked(searchProducts)
      .mockResolvedValueOnce({
        items: Array.from({ length: 20 }, (_, i) => buildItem({ itemId: `SP${i}` })),
        hasNextPage: true,
      })
      .mockResolvedValueOnce({
        items: Array.from({ length: 20 }, (_, i) => buildItem({ itemId: `SP${20 + i}` })),
        hasNextPage: true,
      })
      .mockResolvedValueOnce({
        items: Array.from({ length: 20 }, (_, i) => buildItem({ itemId: `SP${40 + i}` })),
        hasNextPage: true,
      });
    vi.mocked(persistItems).mockResolvedValue({ inserted: 50, skipped: 0 });

    const result = await collectShopee("eletrônicos");

    expect(searchProducts).toHaveBeenCalledTimes(3);
    expect(searchProducts).toHaveBeenNthCalledWith(1, "eletrônicos", 1);
    expect(searchProducts).toHaveBeenNthCalledWith(2, "eletrônicos", 2);
    expect(searchProducts).toHaveBeenNthCalledWith(3, "eletrônicos", 3);
    expect(result.attempted).toBe(50);
  });

  it("stops paging when hasNextPage is false", async () => {
    vi.mocked(searchProducts).mockResolvedValue({ items: [buildItem()], hasNextPage: false });
    vi.mocked(persistItems).mockResolvedValue({ inserted: 1, skipped: 0 });

    const result = await collectShopee("eletrônicos");

    expect(searchProducts).toHaveBeenCalledTimes(1);
    expect(result.attempted).toBe(1);
  });

  it("persists the mapped items and returns the counts from persistItems", async () => {
    vi.mocked(searchProducts).mockResolvedValue({ items: [buildItem()], hasNextPage: false });
    vi.mocked(persistItems).mockResolvedValue({ inserted: 1, skipped: 0 });

    const result = await collectShopee("eletrônicos");

    expect(persistItems).toHaveBeenCalledWith("SHOPEE", [expect.objectContaining({ productId: "SP1" })]);
    expect(result).toEqual({ attempted: 1, inserted: 1, skipped: 0 });
  });

  it("returns a collect_failed error without throwing on any error", async () => {
    vi.mocked(searchProducts).mockRejectedValue(new Error("boom"));

    const result = await collectShopee("eletrônicos");

    expect(result).toEqual({ attempted: 0, inserted: 0, skipped: 0, error: "collect_failed" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/collect/shopee.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/lib/collect/shopee.ts`:

```typescript
import { searchProducts, type ShopeeHubItem } from "@/lib/shopee/hubClient";
import { persistItems } from "@/lib/collect/persist";
import { pickRandomSearchTerm } from "@/lib/collect/searchTerms";
import type { CollectItem, CollectResult } from "@/lib/collect/types";

const TARGET_ITEM_COUNT = 50;

export function mapShopeeItems(items: ShopeeHubItem[]): CollectItem[] {
  return items.map((item) => ({
    productId: item.itemId,
    title: item.title,
    affiliateLink: item.affiliateLink,
    image: item.image,
    price: item.price,
    oldPrice: null,
    discount: item.discount,
  }));
}

export async function collectShopee(term?: string): Promise<CollectResult> {
  const searchTerm = term ?? pickRandomSearchTerm();

  try {
    const fetched: ShopeeHubItem[] = [];
    let page = 1;
    while (fetched.length < TARGET_ITEM_COUNT) {
      const result = await searchProducts(searchTerm, page);
      if (result.items.length === 0) {
        break;
      }
      fetched.push(...result.items);
      if (!result.hasNextPage) {
        break;
      }
      page += 1;
    }
    const items = fetched.slice(0, TARGET_ITEM_COUNT);

    if (items.length === 0) {
      return { attempted: 0, inserted: 0, skipped: 0 };
    }

    const mapped = mapShopeeItems(items);
    const { inserted, skipped } = await persistItems("SHOPEE", mapped);
    return { attempted: items.length, inserted, skipped };
  } catch (error) {
    console.error("collectShopee failed:", error);
    return { attempted: 0, inserted: 0, skipped: 0, error: "collect_failed" };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/collect/shopee.test.ts`
Expected: PASS, all tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/collect/shopee.ts tests/collect/shopee.test.ts
git commit -m "feat: add Shopee automatic collector"
```

---

### Task 11: `POST /api/cron/collect` — runs all three collectors

**Files:**
- Create: `src/app/api/cron/collect/route.ts`
- Test: `tests/api/cron/collect.test.ts`

**Interfaces:**
- Consumes: `collectAmazon` (Task 9), `collectMercadoLivre` (Task 8), `collectShopee` (Task 10)
- Produces: `POST` → `{ amazon: CollectResult; mercadoLivre: CollectResult; shopee: CollectResult }`, HTTP 200 if none of the three has an `error`, HTTP 207 if at least one does, HTTP 401 without a valid bearer secret

- [ ] **Step 1: Write the failing test**

Create `tests/api/cron/collect.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/collect/amazon", () => ({ collectAmazon: vi.fn() }));
vi.mock("@/lib/collect/mercadolivre", () => ({ collectMercadoLivre: vi.fn() }));
vi.mock("@/lib/collect/shopee", () => ({ collectShopee: vi.fn() }));

import { POST } from "@/app/api/cron/collect/route";
import { collectAmazon } from "@/lib/collect/amazon";
import { collectMercadoLivre } from "@/lib/collect/mercadolivre";
import { collectShopee } from "@/lib/collect/shopee";

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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api/cron/collect.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/app/api/cron/collect/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { collectAmazon } from "@/lib/collect/amazon";
import { collectMercadoLivre } from "@/lib/collect/mercadolivre";
import { collectShopee } from "@/lib/collect/shopee";
import type { CollectResult } from "@/lib/collect/types";

function toResult(settled: PromiseSettledResult<CollectResult>): CollectResult {
  if (settled.status === "fulfilled") {
    return settled.value;
  }
  return { attempted: 0, inserted: 0, skipped: 0, error: String(settled.reason) };
}

export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization");
  const secret = process.env.CRON_COLLECT_SECRET;
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const [amazon, mercadoLivre, shopee] = await Promise.allSettled([
    collectAmazon(),
    collectMercadoLivre(),
    collectShopee(),
  ]);

  const results = {
    amazon: toResult(amazon),
    mercadoLivre: toResult(mercadoLivre),
    shopee: toResult(shopee),
  };

  const hasError = Object.values(results).some((result) => result.error !== undefined);
  return NextResponse.json(results, { status: hasError ? 207 : 200 });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/api/cron/collect.test.ts`
Expected: PASS, all tests.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/cron/collect/route.ts tests/api/cron/collect.test.ts
git commit -m "feat: add POST /api/cron/collect running all three collectors"
```

---

### Task 12: `GET /api/admin/highlights` — add marketplace filter, remove `POST`

**Files:**
- Modify: `src/app/api/admin/highlights/route.ts`
- Modify: `tests/api/admin/highlights/route.test.ts`

**Interfaces:**
- Consumes: `listTodaysHighlights(marketplace?: Marketplace)` (Task 5), `isAuthorizedAdminRequest` (existing)
- Produces: `GET ?marketplace=` → `{ items: Highlight[] }` (marketplace omitted = every marketplace). No more `POST` export — `persistItems` (Task 6, wired into each hub's route in Tasks 13-15) is now the only write path into `Highlight`.

- [ ] **Step 1: Write the failing test**

Replace `tests/api/admin/highlights/route.test.ts` with:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/highlights/store", () => ({
  listTodaysHighlights: vi.fn(),
}));

import { GET } from "@/app/api/admin/highlights/route";
import { listTodaysHighlights } from "@/lib/highlights/store";
import { ADMIN_SESSION_COOKIE, createSessionToken } from "@/lib/adminSession";

function authHeader() {
  return { cookie: `${ADMIN_SESSION_COOKIE}=${createSessionToken()}` };
}

describe("GET /api/admin/highlights", () => {
  beforeEach(() => {
    process.env.ADMIN_PASSWORD = "test-password";
  });
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.ADMIN_PASSWORD;
  });

  it("returns 401 without calling listTodaysHighlights when the session cookie is missing or invalid", async () => {
    const response = await GET(new NextRequest("http://localhost/api/admin/highlights"));

    expect(response.status).toBe(401);
    expect(listTodaysHighlights).not.toHaveBeenCalled();
  });

  it("returns today's highlights across every marketplace when no marketplace param is given", async () => {
    vi.mocked(listTodaysHighlights).mockResolvedValue([{ id: "hl1" }] as never);

    const response = await GET(
      new NextRequest("http://localhost/api/admin/highlights", { headers: authHeader() })
    );
    const body = await response.json();

    expect(listTodaysHighlights).toHaveBeenCalledWith(undefined);
    expect(body.items).toEqual([{ id: "hl1" }]);
  });

  it("filters by marketplace when the param is given and valid", async () => {
    vi.mocked(listTodaysHighlights).mockResolvedValue([] as never);

    await GET(
      new NextRequest("http://localhost/api/admin/highlights?marketplace=AMAZON", {
        headers: authHeader(),
      })
    );

    expect(listTodaysHighlights).toHaveBeenCalledWith("AMAZON");
  });

  it("ignores an invalid marketplace param and lists every marketplace instead", async () => {
    vi.mocked(listTodaysHighlights).mockResolvedValue([] as never);

    await GET(
      new NextRequest("http://localhost/api/admin/highlights?marketplace=NOT_REAL", {
        headers: authHeader(),
      })
    );

    expect(listTodaysHighlights).toHaveBeenCalledWith(undefined);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api/admin/highlights/route.test.ts`
Expected: FAIL — the current `GET` always calls `listTodaysHighlights()` with no args, and `POST` is still exported (harmless for these tests, but the file's `createHighlight`/`isValidNote` mocks/imports will be gone in the new version).

- [ ] **Step 3: Rewrite the route**

Replace `src/app/api/admin/highlights/route.ts` with:

```typescript
import { NextRequest, NextResponse } from "next/server";
import type { Marketplace } from "@prisma/client";
import { isAuthorizedAdminRequest } from "@/lib/adminSession";
import { listTodaysHighlights } from "@/lib/highlights/store";

const VALID_MARKETPLACES: Marketplace[] = ["MERCADO_LIVRE", "AMAZON", "SHOPEE"];

function parseMarketplace(request: NextRequest): Marketplace | undefined {
  const raw = request.nextUrl.searchParams.get("marketplace");
  return VALID_MARKETPLACES.includes(raw as Marketplace) ? (raw as Marketplace) : undefined;
}

export async function GET(request: NextRequest) {
  if (!isAuthorizedAdminRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const items = await listTodaysHighlights(parseMarketplace(request));
  return NextResponse.json({ items });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/api/admin/highlights/route.test.ts`
Expected: PASS, all 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/admin/highlights/route.ts tests/api/admin/highlights/route.test.ts
git commit -m "refactor: add marketplace filter to GET /api/admin/highlights, remove manual POST"
```

---

### Task 13: Amazon hub — pool-backed deals route + `AmazonAdmin.tsx` rewrite

**Files:**
- Modify: `src/app/api/admin/amazon/deals/route.ts`
- Modify: `tests/api/admin/amazon/deals.test.ts`
- Modify: `src/app/admin/amazon/AmazonAdmin.tsx`

**Interfaces:**
- Consumes: `mapAmazonItems` (Task 9), `persistItems`, `findHighlightsByProductIds` (Task 6), `listTodaysHighlights` via `GET /api/admin/highlights?marketplace=AMAZON` (Task 12)
- Produces: `GET /api/admin/amazon/deals?offset=` → `{ items: Highlight[]; nextIndex: number | null }` (every returned item is now a full `Highlight` row — has `id`, so the "Remover da vitrine" button works on it directly)

- [ ] **Step 1: Write the failing test for the route**

Replace `tests/api/admin/amazon/deals.test.ts` with:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/amazon/session", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/amazon/hubClient", async () => {
  const actual = await vi.importActual("@/lib/amazon/hubClient");
  return { ...actual, listDeals: vi.fn() };
});
vi.mock("@/lib/collect/persist", () => ({
  persistItems: vi.fn(),
  findHighlightsByProductIds: vi.fn(),
}));

import { GET } from "@/app/api/admin/amazon/deals/route";
import { getSession } from "@/lib/amazon/session";
import { listDeals, AmazonSessionExpiredError } from "@/lib/amazon/hubClient";
import { persistItems, findHighlightsByProductIds } from "@/lib/collect/persist";
import { ADMIN_SESSION_COOKIE, createSessionToken } from "@/lib/adminSession";

function authHeader() {
  return { cookie: `${ADMIN_SESSION_COOKIE}=${createSessionToken()}` };
}

const dealItem = {
  asin: "B0GQWF5JD1",
  title: "Produto",
  price: 10,
  oldPrice: null,
  discountLabel: null,
  image: "https://img.example/1.jpg",
  permalink: "https://www.amazon.com.br/dp/B0GQWF5JD1",
  affiliateLink: "https://www.amazon.com.br/dp/B0GQWF5JD1?tag=bonsachados0f-20",
};

const highlightRow = { id: "hl1", marketplace: "AMAZON", productId: "B0GQWF5JD1" };

function buildRequest(offset?: number) {
  const url = new URL("http://localhost/api/admin/amazon/deals");
  if (offset !== undefined) {
    url.searchParams.set("offset", String(offset));
  }
  return new NextRequest(url, { headers: authHeader() });
}

describe("GET /api/admin/amazon/deals", () => {
  beforeEach(() => {
    process.env.ADMIN_USER = "admin";
    process.env.ADMIN_PASSWORD = "test-password";
  });
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.ADMIN_USER;
    delete process.env.ADMIN_PASSWORD;
  });

  it("returns 401 without calling any library functions when the session cookie is missing or invalid", async () => {
    const response = await GET(new NextRequest("http://localhost/api/admin/amazon/deals"));

    expect(response.status).toBe(401);
    expect(getSession).not.toHaveBeenCalled();
    expect(listDeals).not.toHaveBeenCalled();
  });

  it("returns 401 session_expired when no session is stored", async () => {
    vi.mocked(getSession).mockResolvedValue(null);

    const response = await GET(buildRequest());
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: "session_expired" });
    expect(listDeals).not.toHaveBeenCalled();
  });

  it("persists the fetched items and returns the enriched pool rows plus nextIndex", async () => {
    vi.mocked(getSession).mockResolvedValue({ cookieHeader: "a=b" });
    vi.mocked(listDeals).mockResolvedValue({ items: [dealItem], nextIndex: 30 });
    vi.mocked(findHighlightsByProductIds).mockResolvedValue([highlightRow] as never);

    const response = await GET(buildRequest());
    const body = await response.json();

    expect(listDeals).toHaveBeenCalledWith(0, { cookieHeader: "a=b" });
    expect(persistItems).toHaveBeenCalledWith(
      "AMAZON",
      [expect.objectContaining({ productId: "B0GQWF5JD1" })]
    );
    expect(findHighlightsByProductIds).toHaveBeenCalledWith("AMAZON", ["B0GQWF5JD1"]);
    expect(body).toEqual({ items: [highlightRow], nextIndex: 30 });
  });

  it("passes the offset query param through to listDeals for pagination", async () => {
    vi.mocked(getSession).mockResolvedValue({ cookieHeader: "a=b" });
    vi.mocked(listDeals).mockResolvedValue({ items: [], nextIndex: 60 });
    vi.mocked(findHighlightsByProductIds).mockResolvedValue([]);

    await GET(buildRequest(30));

    expect(listDeals).toHaveBeenCalledWith(30, { cookieHeader: "a=b" });
  });

  it("defaults to offset 0 when the offset param is missing, negative, or invalid", async () => {
    vi.mocked(getSession).mockResolvedValue({ cookieHeader: "a=b" });
    vi.mocked(listDeals).mockResolvedValue({ items: [], nextIndex: 30 });
    vi.mocked(findHighlightsByProductIds).mockResolvedValue([]);

    await GET(buildRequest(-5));

    expect(listDeals).toHaveBeenCalledWith(0, { cookieHeader: "a=b" });
  });

  it("returns 401 session_expired when the client throws AmazonSessionExpiredError", async () => {
    vi.mocked(getSession).mockResolvedValue({ cookieHeader: "a=b" });
    vi.mocked(listDeals).mockRejectedValue(new AmazonSessionExpiredError());

    const response = await GET(buildRequest());
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: "session_expired" });
  });

  it("returns 502 on any other error", async () => {
    vi.mocked(getSession).mockResolvedValue({ cookieHeader: "a=b" });
    vi.mocked(listDeals).mockRejectedValue(new Error("boom"));

    const response = await GET(buildRequest());

    expect(response.status).toBe(502);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api/admin/amazon/deals.test.ts`
Expected: FAIL — the current route returns raw `AmazonDealItem[]`, never calls `persistItems`/`findHighlightsByProductIds`.

- [ ] **Step 3: Rewrite the route**

Replace `src/app/api/admin/amazon/deals/route.ts` with:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/amazon/session";
import { listDeals, AmazonSessionExpiredError } from "@/lib/amazon/hubClient";
import { mapAmazonItems } from "@/lib/collect/amazon";
import { persistItems, findHighlightsByProductIds } from "@/lib/collect/persist";
import { isAuthorizedAdminRequest } from "@/lib/adminSession";

export async function GET(request: NextRequest) {
  if (!isAuthorizedAdminRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const rawOffset = Number(request.nextUrl.searchParams.get("offset"));
  const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? rawOffset : 0;

  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "session_expired" }, { status: 401 });
  }

  try {
    const { items, nextIndex } = await listDeals(offset, session);
    await persistItems("AMAZON", mapAmazonItems(items));
    const rows = await findHighlightsByProductIds("AMAZON", items.map((item) => item.asin));
    return NextResponse.json({ items: rows, nextIndex });
  } catch (error) {
    if (error instanceof AmazonSessionExpiredError) {
      return NextResponse.json({ error: "session_expired" }, { status: 401 });
    }
    console.error("Amazon deals search failed:", error);
    return NextResponse.json({ error: "deals_failed" }, { status: 502 });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/api/admin/amazon/deals.test.ts`
Expected: PASS, all 7 tests.

- [ ] **Step 5: Rewrite `AmazonAdmin.tsx`**

Replace `src/app/admin/amazon/AmazonAdmin.tsx` with:

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";

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

function StatusDot({ active }: { active: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`size-2 rounded-full ${active ? "bg-gold" : "bg-alert"}`}
    />
  );
}

export default function AmazonAdmin() {
  const [hasSession, setHasSession] = useState<boolean | null>(null);
  const [showSessionForm, setShowSessionForm] = useState(false);
  const [curlCommand, setCurlCommand] = useState("");
  const [savingSession, setSavingSession] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);

  const [items, setItems] = useState<PoolItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextOffset, setNextOffset] = useState(0);
  const [noMorePages, setNoMorePages] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [selectingId, setSelectingId] = useState<string | null>(null);
  const [selectedForPost, setSelectedForPost] = useState<Record<string, boolean>>({});
  const [removingId, setRemovingId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/amazon/session")
      .then((response) => response.json())
      .then((body) => setHasSession(Boolean(body.hasSession)))
      .catch(() => setHasSession(false));
  }, []);

  const expireSession = useCallback(() => {
    setHasSession(false);
    setShowSessionForm(true);
    setSessionError("A sessão da Amazon expirou. Cole os cookies novamente.");
  }, []);

  async function handleSaveSession(event: React.FormEvent) {
    event.preventDefault();
    setSavingSession(true);
    setSessionError(null);
    try {
      const response = await fetch("/api/admin/amazon/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ curlCommand }),
      });
      if (!response.ok) {
        setSessionError(
          "Não achei o Cookie nesse curl. Confirma que copiou a requisição products/search inteira e tenta de novo."
        );
        return;
      }
      setHasSession(true);
      setShowSessionForm(false);
      setCurlCommand("");
    } catch {
      setSessionError("Não deu para salvar a sessão. Verifique a conexão e tente de novo.");
    } finally {
      setSavingSession(false);
    }
  }

  // Loads the pool already collected for this marketplace — a database
  // read, no live Amazon request, so it doesn't depend on hasSession.
  useEffect(() => {
    setLoading(true);
    fetch("/api/admin/highlights?marketplace=AMAZON")
      .then((response) => response.json())
      .then((body) => {
        setItems(body.items ?? []);
        setLoaded(true);
      })
      .catch(() => setLoadError("Não deu para carregar as ofertas já coletadas."))
      .finally(() => setLoading(false));
  }, []);

  async function handleLoadMore() {
    setLoadingMore(true);
    setLoadError(null);
    try {
      const response = await fetch(`/api/admin/amazon/deals?offset=${nextOffset}`);
      if (response.status === 401) {
        expireSession();
        return;
      }
      const body = await response.json();
      if (!response.ok) {
        throw new Error("deals_failed");
      }
      const fetchedItems = body.items as PoolItem[];
      setItems((previous) => {
        const seenIds = new Set(previous.map((item) => item.id));
        return [...previous, ...fetchedItems.filter((item) => !seenIds.has(item.id))];
      });
      if (body.nextIndex === null) {
        setNoMorePages(true);
      } else {
        setNextOffset(body.nextIndex);
      }
      setLoaded(true);
    } catch {
      setLoadError("Não deu para carregar mais ofertas. Tente de novo em alguns segundos.");
    } finally {
      setLoadingMore(false);
    }
  }

  async function handleSelectForPost(item: PoolItem) {
    setSelectingId(item.id);
    setLoadError(null);
    try {
      const response = await fetch("/api/admin/postdraft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          marketplace: "AMAZON",
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
        setSelectedForPost((previous) => ({ ...previous, [item.id]: true }));
        return;
      }
      if (!response.ok) {
        setLoadError(`Não deu para selecionar "${item.title}" para postar. Tente de novo.`);
        return;
      }
      setSelectedForPost((previous) => ({ ...previous, [item.id]: true }));
    } catch {
      setLoadError(`Não deu para selecionar "${item.title}" para postar. Tente de novo.`);
    } finally {
      setSelectingId(null);
    }
  }

  async function handleRemove(item: PoolItem) {
    setRemovingId(item.id);
    setLoadError(null);
    try {
      const response = await fetch(`/api/admin/highlights/${item.id}`, { method: "DELETE" });
      if (!response.ok) {
        throw new Error("remove_failed");
      }
      setItems((previous) => previous.filter((existing) => existing.id !== item.id));
    } catch {
      setLoadError(`Não deu para remover "${item.title}" da vitrine. Tente de novo.`);
    } finally {
      setRemovingId(null);
    }
  }

  async function handleCopy(id: string, link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setCopiedId(id);
      window.setTimeout(() => setCopiedId(null), 2000);
    } catch {
      setLoadError("O navegador bloqueou a cópia. Selecione o link e copie na mão.");
    }
  }

  const sessionFormVisible = hasSession === false || showSessionForm;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] tracking-[0.22em] text-ash uppercase">Amazon</p>
          <h1 className="font-display font-stretch-condensed text-3xl leading-none font-black text-paper uppercase italic sm:text-4xl">
            Ofertas do <span className="text-gold">mês</span>
          </h1>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-ink-line bg-ink-raised px-3 py-1.5">
          <StatusDot active={hasSession === true} />
          <span className="font-mono text-[11px] tracking-wider text-ash uppercase">
            {hasSession === null ? "verificando" : hasSession ? "sessão ativa" : "sem sessão"}
          </span>
        </div>
      </div>

      <div className="mt-8">
        {sessionFormVisible && (
          <section className="mb-10 rounded-2xl border border-ink-line bg-ink-raised p-6 sm:p-8">
            <h2 className="font-display font-stretch-condensed text-xl font-black tracking-tight text-gold uppercase italic">
              Conectar a sessão da Amazon
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-ash">
              A coleta automática e o botão &quot;Carregar mais&quot; reusam a sua sessão do
              navegador. Ela costuma durar bastante tempo.
            </p>

            <ol className="mt-5 max-w-2xl space-y-3 text-sm text-paper/80">
              {[
                <>
                  Abra{" "}
                  <a
                    href="https://www.amazon.com.br/events/ofertasmensais"
                    target="_blank"
                    rel="noreferrer"
                    className="text-gold underline decoration-gold/40 underline-offset-4 hover:decoration-gold focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
                  >
                    amazon.com.br/events/ofertasmensais
                  </a>{" "}
                  logado na sua conta.
                </>,
                <>
                  No DevTools (F12), vá para a aba{" "}
                  <strong className="font-semibold text-paper">Network</strong> e role a página
                  pra carregar mais ofertas.
                </>,
                <>
                  Clique com o botão direito na requisição{" "}
                  <code className="font-mono text-gold">products/search</code>, escolha{" "}
                  <strong className="font-semibold text-paper">Copy → Copy as cURL</strong>.
                </>,
                <>Cole o curl inteiro no campo abaixo — o painel extrai o Cookie sozinho.</>,
              ].map((step, index) => (
                <li key={index} className="flex gap-3">
                  <span className="mt-px shrink-0 font-mono text-xs text-gold tabular-nums">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>

            <form onSubmit={handleSaveSession} className="mt-7 space-y-4">
              <label className="block">
                <span className="font-mono text-[11px] tracking-[0.18em] text-ash uppercase">
                  Curl da requisição products/search
                </span>
                <textarea
                  required
                  value={curlCommand}
                  onChange={(event) => setCurlCommand(event.target.value)}
                  placeholder="curl --url 'https://www.amazon.com.br/d2b/api/v1/products/search…"
                  rows={8}
                  className="mt-2 w-full resize-y rounded-xl border border-ink-line bg-ink p-3 font-mono text-xs text-paper placeholder:text-ash/60 focus-visible:border-gold focus-visible:ring-2 focus-visible:ring-gold/40 focus-visible:outline-none"
                />
              </label>

              {sessionError && (
                <p role="alert" className="text-sm text-alert">
                  {sessionError}
                </p>
              )}

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="submit"
                  disabled={savingSession}
                  className="rounded-full bg-gold px-6 py-2.5 font-display font-stretch-condensed text-sm font-black tracking-wide text-ink uppercase italic transition hover:bg-paper focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-ink-raised focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {savingSession ? "Salvando…" : "Salvar sessão"}
                </button>
                {hasSession && (
                  <button
                    type="button"
                    onClick={() => setShowSessionForm(false)}
                    className="font-mono text-xs tracking-wider text-ash uppercase transition hover:text-paper focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
                  >
                    Cancelar
                  </button>
                )}
              </div>
            </form>
          </section>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p aria-live="polite" className="font-mono text-[11px] tracking-[0.2em] text-ash uppercase">
            {loading
              ? "carregando…"
              : items.length > 0
                ? `${items.length} oferta${items.length === 1 ? "" : "s"} na vitrine hoje`
                : ""}
          </p>
          {hasSession && !showSessionForm && (
            <button
              type="button"
              onClick={() => setShowSessionForm(true)}
              className="font-mono text-xs tracking-wider text-ash uppercase transition hover:text-paper focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
            >
              Trocar sessão
            </button>
          )}
        </div>

        {loadError && (
          <p
            role="alert"
            className="mt-6 rounded-xl border border-alert/40 bg-alert/10 px-4 py-3 text-sm text-paper"
          >
            {loadError}
          </p>
        )}

        {loaded && items.length === 0 && !loading && !loadError && (
          <p className="mt-10 text-sm text-ash">
            Nenhuma oferta na vitrine ainda. A coleta automática roda a cada 20 minutos.
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
                    onClick={() => handleSelectForPost(item)}
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

        {hasSession && !noMorePages && (
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

Note `nextOffset` starts at `0` (not `null`) — the "Carregar mais" button is visible as soon as a session is connected, even before any live fetch happens, so it doubles as the manual "top up the pool now" action the spec describes. It only hides once the live feed itself reports `nextIndex: null` (`noMorePages` flips true). Because a manual live fetch can return items the cron already pooled earlier today, `handleLoadMore` dedupes by `id` before appending, so re-fetching the same page twice never doubles a card on screen.

- [ ] **Step 6: Manually smoke-check the page compiles and lints**

Run: `npx tsc --noEmit && npx eslint src/app/admin/amazon`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/admin/amazon/deals/route.ts tests/api/admin/amazon/deals.test.ts src/app/admin/amazon/AmazonAdmin.tsx
git commit -m "feat: back the Amazon hub with the shared pool, remove manual highlight UI"
```

---

### Task 14: Mercado Livre hub — pool-backed search route + `MercadoLivreAdmin.tsx` rewrite

**Files:**
- Modify: `src/app/api/admin/mercadolivre/search/route.ts`
- Modify: `tests/api/admin/mercadolivre/search.test.ts`
- Modify: `src/app/admin/mercadolivre/MercadoLivreAdmin.tsx`

**Interfaces:**
- Consumes: `mapMercadoLivreItems` (Task 8), `persistItems`, `findHighlightsByProductIds` (Task 6), `listTodaysHighlights` via `GET /api/admin/highlights?marketplace=MERCADO_LIVRE` (Task 12)
- Produces: `GET /api/admin/mercadolivre/search?q=&offset=` → `{ items: Highlight[]; fetchedCount: number }`. `fetchedCount` is the raw count the live ML search returned for this page (before pool filtering) — the client needs it (not `items.length`) to compute the next `offset` and to decide whether more pages exist, since `items` can be shorter than what was fetched (an item invalid or filtered by `persistItems` won't have a row to return).

**Design note:** like the Amazon hub (Task 13), every card in this hub now renders from a `Highlight` row (`PoolItem`), not from the richer raw `MLHubItem` (rating, sold count, commission chip). This trades away that extra display richness for one consistent card shape across all three hubs, matching Amazon/Shopee — the rating/commission info existed to help a human decide what to manually curate onto the vitrine, a decision the pipeline now makes automatically, so keeping it isn't required by the spec and isn't worth the complexity of juggling two item shapes in one grid.

- [ ] **Step 1: Write the failing test for the route**

Replace `tests/api/admin/mercadolivre/search.test.ts` with:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/mercadolivre/session", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/mercadolivre/hubClient", async () => {
  const actual = await vi.importActual("@/lib/mercadolivre/hubClient");
  return { ...actual, searchAffiliateProducts: vi.fn() };
});
vi.mock("@/lib/collect/mercadolivre", () => ({ mapMercadoLivreItems: vi.fn() }));
vi.mock("@/lib/collect/persist", () => ({
  persistItems: vi.fn(),
  findHighlightsByProductIds: vi.fn(),
}));

import { GET } from "@/app/api/admin/mercadolivre/search/route";
import { getSession } from "@/lib/mercadolivre/session";
import { searchAffiliateProducts, MercadoLivreSessionExpiredError } from "@/lib/mercadolivre/hubClient";
import { mapMercadoLivreItems } from "@/lib/collect/mercadolivre";
import { persistItems, findHighlightsByProductIds } from "@/lib/collect/persist";
import { ADMIN_SESSION_COOKIE, createSessionToken } from "@/lib/adminSession";

function authHeader() {
  return { cookie: `${ADMIN_SESSION_COOKIE}=${createSessionToken()}` };
}

const session = { cookieHeader: "a=b", csrfToken: "tok" };
const mlItem = {
  itemId: "MLB1",
  title: "Creatina 1kg",
  price: 59.9,
  oldPrice: null,
  discountLabel: null,
  rating: null,
  soldLabel: null,
  image: "https://img.example/1.webp",
  permalink: "https://ml.com/MLB1",
  commissionLabel: null,
};
const highlightRow = { id: "hl1", marketplace: "MERCADO_LIVRE", productId: "MLB1" };

describe("GET /api/admin/mercadolivre/search", () => {
  beforeEach(() => {
    process.env.ADMIN_USER = "admin";
    process.env.ADMIN_PASSWORD = "test-password";
  });
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.ADMIN_USER;
    delete process.env.ADMIN_PASSWORD;
  });

  it("returns 401 without calling the session or search when unauthorized", async () => {
    const response = await GET(new NextRequest("http://localhost/api/admin/mercadolivre/search"));

    expect(response.status).toBe(401);
    expect(getSession).not.toHaveBeenCalled();
  });

  it("returns 401 session_expired when there's no saved session", async () => {
    vi.mocked(getSession).mockResolvedValue(null);

    const response = await GET(
      new NextRequest("http://localhost/api/admin/mercadolivre/search", { headers: authHeader() })
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: "session_expired" });
  });

  it("searches, persists the mapped items, and returns the enriched pool rows plus fetchedCount", async () => {
    vi.mocked(getSession).mockResolvedValue(session);
    vi.mocked(searchAffiliateProducts).mockResolvedValue([mlItem]);
    vi.mocked(mapMercadoLivreItems).mockResolvedValue([
      {
        productId: "MLB1",
        title: "Creatina 1kg",
        affiliateLink: "https://meli.la/x",
        image: "https://img.example/1.webp",
        price: 59.9,
        oldPrice: null,
        discount: null,
      },
    ]);
    vi.mocked(findHighlightsByProductIds).mockResolvedValue([highlightRow] as never);

    const response = await GET(
      new NextRequest("http://localhost/api/admin/mercadolivre/search?q=fone&offset=18", {
        headers: authHeader(),
      })
    );
    const body = await response.json();

    expect(searchAffiliateProducts).toHaveBeenCalledWith("fone", session, 18);
    expect(mapMercadoLivreItems).toHaveBeenCalledWith([mlItem], session);
    expect(persistItems).toHaveBeenCalledWith("MERCADO_LIVRE", [
      expect.objectContaining({ productId: "MLB1" }),
    ]);
    expect(findHighlightsByProductIds).toHaveBeenCalledWith("MERCADO_LIVRE", ["MLB1"]);
    expect(body).toEqual({ items: [highlightRow], fetchedCount: 1 });
  });

  it("defaults offset to 0 and query to empty when not given", async () => {
    vi.mocked(getSession).mockResolvedValue(session);
    vi.mocked(searchAffiliateProducts).mockResolvedValue([]);
    vi.mocked(mapMercadoLivreItems).mockResolvedValue([]);
    vi.mocked(findHighlightsByProductIds).mockResolvedValue([]);

    await GET(new NextRequest("http://localhost/api/admin/mercadolivre/search", { headers: authHeader() }));

    expect(searchAffiliateProducts).toHaveBeenCalledWith("", session, 0);
  });

  it("returns 401 session_expired when MercadoLivreSessionExpiredError is thrown", async () => {
    vi.mocked(getSession).mockResolvedValue(session);
    vi.mocked(searchAffiliateProducts).mockRejectedValue(new MercadoLivreSessionExpiredError());

    const response = await GET(
      new NextRequest("http://localhost/api/admin/mercadolivre/search", { headers: authHeader() })
    );

    expect(response.status).toBe(401);
  });

  it("returns 502 on any other error", async () => {
    vi.mocked(getSession).mockResolvedValue(session);
    vi.mocked(searchAffiliateProducts).mockRejectedValue(new Error("boom"));

    const response = await GET(
      new NextRequest("http://localhost/api/admin/mercadolivre/search", { headers: authHeader() })
    );

    expect(response.status).toBe(502);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api/admin/mercadolivre/search.test.ts`
Expected: FAIL — current route (from Task 7) returns raw `{ items: MLHubItem[] }`, no `fetchedCount`, never persists.

- [ ] **Step 3: Rewrite the route**

Replace `src/app/api/admin/mercadolivre/search/route.ts` with:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/mercadolivre/session";
import { searchAffiliateProducts, MercadoLivreSessionExpiredError } from "@/lib/mercadolivre/hubClient";
import { mapMercadoLivreItems } from "@/lib/collect/mercadolivre";
import { persistItems, findHighlightsByProductIds } from "@/lib/collect/persist";
import { isAuthorizedAdminRequest } from "@/lib/adminSession";

export async function GET(request: NextRequest) {
  if (!isAuthorizedAdminRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const query = request.nextUrl.searchParams.get("q") ?? "";
  const rawOffset = Number(request.nextUrl.searchParams.get("offset"));
  const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? rawOffset : 0;

  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "session_expired" }, { status: 401 });
  }

  try {
    const items = await searchAffiliateProducts(query, session, offset);
    const mapped = await mapMercadoLivreItems(items, session);
    await persistItems("MERCADO_LIVRE", mapped);
    const rows = await findHighlightsByProductIds("MERCADO_LIVRE", items.map((item) => item.itemId));
    return NextResponse.json({ items: rows, fetchedCount: items.length });
  } catch (error) {
    if (error instanceof MercadoLivreSessionExpiredError) {
      return NextResponse.json({ error: "session_expired" }, { status: 401 });
    }
    console.error("Mercado Livre hub search failed:", error);
    return NextResponse.json({ error: "search_failed" }, { status: 502 });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/api/admin/mercadolivre/search.test.ts`
Expected: PASS, all 6 tests.

- [ ] **Step 5: Rewrite `MercadoLivreAdmin.tsx`**

Replace `src/app/admin/mercadolivre/MercadoLivreAdmin.tsx` with:

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";

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

// Mercado Livre's hub doesn't return a total count or a "has more" flag —
// a page shorter than this is treated as the last one.
const PAGE_SIZE = 18;

function StatusDot({ active }: { active: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`size-2 rounded-full ${active ? "bg-gold" : "bg-alert"}`}
    />
  );
}

export default function MercadoLivreAdmin() {
  const [hasSession, setHasSession] = useState<boolean | null>(null);
  const [showSessionForm, setShowSessionForm] = useState(false);
  const [curlCommand, setCurlCommand] = useState("");
  const [savingSession, setSavingSession] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [items, setItems] = useState<PoolItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searched, setSearched] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [liveOffset, setLiveOffset] = useState(0);
  const [lastQuery, setLastQuery] = useState("");
  const [searchError, setSearchError] = useState<string | null>(null);

  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [selectingId, setSelectingId] = useState<string | null>(null);
  const [selectedForPost, setSelectedForPost] = useState<Record<string, boolean>>({});
  const [removingId, setRemovingId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/mercadolivre/session")
      .then((response) => response.json())
      .then((body) => setHasSession(Boolean(body.hasSession)))
      .catch(() => setHasSession(false));
  }, []);

  const expireSession = useCallback(() => {
    setHasSession(false);
    setShowSessionForm(true);
    setSessionError("A sessão do Mercado Livre expirou. Cole os cookies novamente.");
  }, []);

  async function handleSaveSession(event: React.FormEvent) {
    event.preventDefault();
    setSavingSession(true);
    setSessionError(null);
    try {
      const response = await fetch("/api/admin/mercadolivre/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ curlCommand }),
      });
      if (!response.ok) {
        setSessionError(
          "Não achei o Cookie e o x-csrf-token nesse curl. Confirma que copiou a requisição hub/search inteira e tenta de novo."
        );
        return;
      }
      setHasSession(true);
      setShowSessionForm(false);
      setCurlCommand("");
    } catch {
      setSessionError("Não deu para salvar a sessão. Verifique a conexão e tente de novo.");
    } finally {
      setSavingSession(false);
    }
  }

  // Loads the pool already collected for this marketplace — a database
  // read, no live ML request, so it doesn't depend on hasSession.
  useEffect(() => {
    setLoading(true);
    fetch("/api/admin/highlights?marketplace=MERCADO_LIVRE")
      .then((response) => response.json())
      .then((body) => setItems(body.items ?? []))
      .catch(() => setSearchError("Não deu para carregar os produtos já coletados."))
      .finally(() => setLoading(false));
  }, []);

  const fetchSearchPage = useCallback(
    async (term: string, offset: number, mode: "replace" | "append") => {
      const setLoadingState = mode === "replace" ? setSearching : setLoadingMore;
      setLoadingState(true);
      setSearchError(null);
      try {
        const response = await fetch(
          `/api/admin/mercadolivre/search?q=${encodeURIComponent(term)}&offset=${offset}`
        );
        if (response.status === 401) {
          expireSession();
          return;
        }
        const body = await response.json();
        if (!response.ok) {
          throw new Error("search_failed");
        }
        const fetchedItems = body.items as PoolItem[];
        setItems((previous) => {
          if (mode === "replace") {
            return fetchedItems;
          }
          const seenIds = new Set(previous.map((item) => item.id));
          return [...previous, ...fetchedItems.filter((item) => !seenIds.has(item.id))];
        });
        setHasMore(body.fetchedCount >= PAGE_SIZE);
        setLiveOffset(offset + body.fetchedCount);
        setLastQuery(term);
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
    [expireSession]
  );

  async function handleSearch(event: React.FormEvent) {
    event.preventDefault();
    await fetchSearchPage(query, 0, "replace");
  }

  async function handleLoadMore() {
    await fetchSearchPage(lastQuery, liveOffset, "append");
  }

  async function handleSelectForPost(item: PoolItem) {
    setSelectingId(item.id);
    setSearchError(null);
    try {
      const response = await fetch("/api/admin/postdraft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          marketplace: "MERCADO_LIVRE",
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
    try {
      await navigator.clipboard.writeText(link);
      setCopiedId(id);
      window.setTimeout(() => setCopiedId(null), 2000);
    } catch {
      setSearchError("O navegador bloqueou a cópia. Selecione o link e copie na mão.");
    }
  }

  const sessionFormVisible = hasSession === false || showSessionForm;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] tracking-[0.22em] text-ash uppercase">
            Mercado Livre
          </p>
          <h1 className="font-display font-stretch-condensed text-3xl leading-none font-black text-paper uppercase italic sm:text-4xl">
            Hub de <span className="text-gold">afiliados</span>
          </h1>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-ink-line bg-ink-raised px-3 py-1.5">
          <StatusDot active={hasSession === true} />
          <span className="font-mono text-[11px] tracking-wider text-ash uppercase">
            {hasSession === null ? "verificando" : hasSession ? "sessão ativa" : "sem sessão"}
          </span>
        </div>
      </div>

      <div className="mt-8">
        {sessionFormVisible && (
          <section className="mb-10 rounded-2xl border border-ink-line bg-ink-raised p-6 sm:p-8">
            <h2 className="font-display font-stretch-condensed text-xl font-black tracking-tight text-gold uppercase italic">
              Conectar a sessão do Mercado Livre
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-ash">
              A busca manual e a coleta automática reusam a sua sessão do navegador. Ela costuma
              durar algumas horas.
            </p>

            <ol className="mt-5 max-w-2xl space-y-3 text-sm text-paper/80">
              {[
                <>
                  Abra{" "}
                  <a
                    href="https://www.mercadolivre.com.br/afiliados/hub"
                    target="_blank"
                    rel="noreferrer"
                    className="text-gold underline decoration-gold/40 underline-offset-4 hover:decoration-gold focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
                  >
                    mercadolivre.com.br/afiliados/hub
                  </a>{" "}
                  logado na sua conta.
                </>,
                <>
                  No DevTools (F12), vá para a aba <strong className="font-semibold text-paper">Network</strong> e
                  faça uma busca qualquer no hub.
                </>,
                <>
                  Clique com o botão direito na requisição{" "}
                  <code className="font-mono text-gold">hub/search</code>, escolha{" "}
                  <strong className="font-semibold text-paper">Copy → Copy as cURL</strong>.
                </>,
                <>
                  Cole o curl inteiro no campo abaixo — o painel extrai o Cookie e o x-csrf-token
                  sozinho.
                </>,
              ].map((step, index) => (
                <li key={index} className="flex gap-3">
                  <span className="mt-px shrink-0 font-mono text-xs text-gold tabular-nums">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>

            <form onSubmit={handleSaveSession} className="mt-7 space-y-4">
              <label className="block">
                <span className="font-mono text-[11px] tracking-[0.18em] text-ash uppercase">
                  Curl da requisição hub/search
                </span>
                <textarea
                  required
                  value={curlCommand}
                  onChange={(event) => setCurlCommand(event.target.value)}
                  placeholder="curl --url 'https://www.mercadolivre.com.br/affiliate-program/api/hub/search…"
                  rows={8}
                  className="mt-2 w-full resize-y rounded-xl border border-ink-line bg-ink p-3 font-mono text-xs text-paper placeholder:text-ash/60 focus-visible:border-gold focus-visible:ring-2 focus-visible:ring-gold/40 focus-visible:outline-none"
                />
              </label>

              {sessionError && (
                <p role="alert" className="text-sm text-alert">
                  {sessionError}
                </p>
              )}

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="submit"
                  disabled={savingSession}
                  className="rounded-full bg-gold px-6 py-2.5 font-display font-stretch-condensed text-sm font-black tracking-wide text-ink uppercase italic transition hover:bg-paper focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-ink-raised focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {savingSession ? "Salvando…" : "Salvar sessão"}
                </button>
                {hasSession && (
                  <button
                    type="button"
                    onClick={() => setShowSessionForm(false)}
                    className="font-mono text-xs tracking-wider text-ash uppercase transition hover:text-paper focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
                  >
                    Cancelar
                  </button>
                )}
              </div>
            </form>
          </section>
        )}

        {hasSession && (
          <form onSubmit={handleSearch} className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <label htmlFor="ml-query" className="sr-only">
              O que você procura
            </label>
            <input
              id="ml-query"
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
            {!showSessionForm && (
              <button
                type="button"
                onClick={() => setShowSessionForm(true)}
                className="font-mono text-xs tracking-wider text-ash uppercase transition hover:text-paper focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none sm:ml-1"
              >
                Trocar sessão
              </button>
            )}
          </form>
        )}

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
                    onClick={() => handleSelectForPost(item)}
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

- [ ] **Step 6: Manually smoke-check the page compiles and lints**

Run: `npx tsc --noEmit && npx eslint src/app/admin/mercadolivre`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/admin/mercadolivre/search/route.ts tests/api/admin/mercadolivre/search.test.ts src/app/admin/mercadolivre/MercadoLivreAdmin.tsx
git commit -m "feat: back the Mercado Livre hub with the shared pool, remove manual link/highlight UI"
```

---

### Task 15: Shopee hub — pool-backed search route + `ShopeeAdmin.tsx` rewrite

**Files:**
- Modify: `src/app/api/admin/shopee/search/route.ts`
- Modify: `tests/api/admin/shopee/search.test.ts`
- Modify: `src/app/admin/shopee/ShopeeAdmin.tsx`

**Interfaces:**
- Consumes: `mapShopeeItems` (Task 10), `persistItems`, `findHighlightsByProductIds` (Task 6), `listTodaysHighlights` via `GET /api/admin/highlights?marketplace=SHOPEE` (Task 12)
- Produces: `GET /api/admin/shopee/search?q=&page=` → `{ items: Highlight[]; hasNextPage: boolean }` — `hasNextPage` comes straight from the Shopee API, no heuristic needed (unlike ML).

- [ ] **Step 1: Write the failing test for the route**

Find the current `tests/api/admin/shopee/search.test.ts` and replace it with:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/shopee/hubClient", () => ({ searchProducts: vi.fn() }));
vi.mock("@/lib/collect/persist", () => ({
  persistItems: vi.fn(),
  findHighlightsByProductIds: vi.fn(),
}));

import { GET } from "@/app/api/admin/shopee/search/route";
import { searchProducts } from "@/lib/shopee/hubClient";
import { persistItems, findHighlightsByProductIds } from "@/lib/collect/persist";
import { ADMIN_SESSION_COOKIE, createSessionToken } from "@/lib/adminSession";

function authHeader() {
  return { cookie: `${ADMIN_SESSION_COOKIE}=${createSessionToken()}` };
}

const shopeeItem = {
  itemId: "SP1",
  title: "Air Fryer 4L",
  price: 219.9,
  discount: 20,
  image: "https://img.example/2.jpg",
  affiliateLink: "https://s.shopee.com.br/abc",
  productLink: "https://shopee.com.br/product/1/2",
  shopName: "Loja X",
  commissionRate: "0.05",
  ratingStar: 4.7,
};
const highlightRow = { id: "hl1", marketplace: "SHOPEE", productId: "SP1" };

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

  it("returns 401 without calling searchProducts when unauthorized", async () => {
    const response = await GET(new NextRequest("http://localhost/api/admin/shopee/search"));

    expect(response.status).toBe(401);
    expect(searchProducts).not.toHaveBeenCalled();
  });

  it("searches, persists the mapped items, and returns the enriched pool rows plus hasNextPage", async () => {
    vi.mocked(searchProducts).mockResolvedValue({ items: [shopeeItem], hasNextPage: true });
    vi.mocked(findHighlightsByProductIds).mockResolvedValue([highlightRow] as never);

    const response = await GET(
      new NextRequest("http://localhost/api/admin/shopee/search?q=air+fryer&page=2", {
        headers: authHeader(),
      })
    );
    const body = await response.json();

    expect(searchProducts).toHaveBeenCalledWith("air fryer", 2);
    expect(persistItems).toHaveBeenCalledWith("SHOPEE", [expect.objectContaining({ productId: "SP1" })]);
    expect(findHighlightsByProductIds).toHaveBeenCalledWith("SHOPEE", ["SP1"]);
    expect(body).toEqual({ items: [highlightRow], hasNextPage: true });
  });

  it("defaults page to 1 and query to empty when not given", async () => {
    vi.mocked(searchProducts).mockResolvedValue({ items: [], hasNextPage: false });
    vi.mocked(findHighlightsByProductIds).mockResolvedValue([]);

    await GET(new NextRequest("http://localhost/api/admin/shopee/search", { headers: authHeader() }));

    expect(searchProducts).toHaveBeenCalledWith("", 1);
  });

  it("returns 502 on any error", async () => {
    vi.mocked(searchProducts).mockRejectedValue(new Error("boom"));

    const response = await GET(
      new NextRequest("http://localhost/api/admin/shopee/search", { headers: authHeader() })
    );

    expect(response.status).toBe(502);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api/admin/shopee/search.test.ts`
Expected: FAIL — current route returns raw `ShopeeHubItem[]`, never persists.

- [ ] **Step 3: Rewrite the route**

Replace `src/app/api/admin/shopee/search/route.ts` with:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { searchProducts } from "@/lib/shopee/hubClient";
import { mapShopeeItems } from "@/lib/collect/shopee";
import { persistItems, findHighlightsByProductIds } from "@/lib/collect/persist";
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
    await persistItems("SHOPEE", mapShopeeItems(items));
    const rows = await findHighlightsByProductIds("SHOPEE", items.map((item) => item.itemId));
    return NextResponse.json({ items: rows, hasNextPage });
  } catch (error) {
    console.error("Shopee hub search failed:", error);
    return NextResponse.json({ error: "search_failed" }, { status: 502 });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/api/admin/shopee/search.test.ts`
Expected: PASS, all 4 tests.

- [ ] **Step 5: Rewrite `ShopeeAdmin.tsx`**

Replace `src/app/admin/shopee/ShopeeAdmin.tsx` with:

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";

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

export default function ShopeeAdmin() {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<PoolItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searched, setSearched] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);
  const [lastQuery, setLastQuery] = useState("");
  const [searchError, setSearchError] = useState<string | null>(null);

  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [selectingId, setSelectingId] = useState<string | null>(null);
  const [selectedForPost, setSelectedForPost] = useState<Record<string, boolean>>({});
  const [removingId, setRemovingId] = useState<string | null>(null);

  // Loads the pool already collected for this marketplace — a database
  // read, no live Shopee API call.
  useEffect(() => {
    setLoading(true);
    fetch("/api/admin/highlights?marketplace=SHOPEE")
      .then((response) => response.json())
      .then((body) => setItems(body.items ?? []))
      .catch(() => setSearchError("Não deu para carregar os produtos já coletados."))
      .finally(() => setLoading(false));
  }, []);

  const fetchSearchPage = useCallback(async (term: string, targetPage: number, mode: "replace" | "append") => {
    const setLoadingState = mode === "replace" ? setSearching : setLoadingMore;
    setLoadingState(true);
    setSearchError(null);
    try {
      const response = await fetch(
        `/api/admin/shopee/search?q=${encodeURIComponent(term)}&page=${targetPage}`
      );
      const body = await response.json();
      if (!response.ok) {
        throw new Error("search_failed");
      }
      const fetchedItems = body.items as PoolItem[];
      setItems((previous) => {
        if (mode === "replace") {
          return fetchedItems;
        }
        const seenIds = new Set(previous.map((item) => item.id));
        return [...previous, ...fetchedItems.filter((item) => !seenIds.has(item.id))];
      });
      setHasMore(Boolean(body.hasNextPage));
      setPage(targetPage);
      setLastQuery(term);
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
  }, []);

  async function handleSearch(event: React.FormEvent) {
    event.preventDefault();
    await fetchSearchPage(query, 1, "replace");
  }

  async function handleLoadMore() {
    await fetchSearchPage(lastQuery, page + 1, "append");
  }

  async function handleSelectForPost(item: PoolItem) {
    setSelectingId(item.id);
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
    try {
      await navigator.clipboard.writeText(link);
      setCopiedId(id);
      window.setTimeout(() => setCopiedId(null), 2000);
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
                    onClick={() => handleSelectForPost(item)}
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

- [ ] **Step 6: Manually smoke-check the page compiles and lints**

Run: `npx tsc --noEmit && npx eslint src/app/admin/shopee`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/admin/shopee/search/route.ts tests/api/admin/shopee/search.test.ts src/app/admin/shopee/ShopeeAdmin.tsx
git commit -m "feat: back the Shopee hub with the shared pool, remove manual highlight UI"
```

---

### Task 16: `src/app/page.tsx` — paginated, filterable, searchable public vitrine

**Files:**
- Modify: `src/app/page.tsx`

**Interfaces:**
- Consumes: `listHighlightsPage` (Task 5)
- Produces: no new exports — this is the page itself. Query params: `page` (number, default 1), `marketplace` (repeated, one per checked box), `q` (text search), `filtered` (hidden marker, `"1"` once the form has been submitted at least once).

No test file for this task — `src/app/page.tsx` is a Server Component reading Prisma directly and has no existing test coverage in this codebase (same as before this plan; the query logic it depends on is unit-tested via `listHighlightsPage`, Task 5). Verify it manually in Task 19.

- [ ] **Step 1: Rewrite the page**

Replace `src/app/page.tsx` with:

```tsx
import type { Metadata } from "next";
import { Archivo } from "next/font/google";
import Image from "next/image";
import type { Marketplace } from "@prisma/client";
import { listHighlightsPage } from "@/lib/highlights/store";
import VitrineHighlights from "./VitrineHighlights";

const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  axes: ["wdth"],
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "Bons Achados",
  description: "As melhores promoções do dia, selecionadas à mão.",
};

// This page reads live data via a direct Prisma call with no request-time API
// (no cookies/headers/fetch), so Next.js would otherwise prerender it once at
// build time and freeze the HTML, hiding every future highlight.
export const dynamic = "force-dynamic";

const PAGE_SIZE = 30;
const ALL_MARKETPLACES: Marketplace[] = ["MERCADO_LIVRE", "AMAZON", "SHOPEE"];
const MARKETPLACE_LABEL: Record<Marketplace, string> = {
  MERCADO_LIVRE: "Mercado Livre",
  AMAZON: "Amazon",
  SHOPEE: "Shopee",
};

type SearchParams = { [key: string]: string | string[] | undefined };

function parseMarketplaces(searchParams: SearchParams): Marketplace[] {
  if (searchParams.filtered !== "1") {
    return ALL_MARKETPLACES;
  }
  const raw = searchParams.marketplace;
  const values = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return ALL_MARKETPLACES.filter((marketplace) => values.includes(marketplace));
}

function buildPageHref(page: number, marketplaces: Marketplace[], q: string, filtered: boolean): string {
  const params = new URLSearchParams();
  if (filtered) {
    params.set("filtered", "1");
    for (const marketplace of marketplaces) {
      params.append("marketplace", marketplace);
    }
  }
  if (q) {
    params.set("q", q);
  }
  if (page > 1) {
    params.set("page", String(page));
  }
  const query = params.toString();
  return query ? `/?${query}` : "/";
}

export default async function VitrinePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const filtered = params.filtered === "1";
  const marketplaces = parseMarketplaces(params);
  const q = typeof params.q === "string" ? params.q : "";
  const rawPage = Number(Array.isArray(params.page) ? params.page[0] : params.page);
  const page = Number.isFinite(rawPage) && rawPage > 1 ? Math.floor(rawPage) : 1;

  const { items, hasNextPage } = await listHighlightsPage({ page, pageSize: PAGE_SIZE, marketplaces, q });

  return (
    <div className={`${archivo.variable} flex min-h-screen flex-col bg-paper font-body text-ink`}>
      <header className="border-b border-ink/10">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-6 py-5">
          <Image
            src="/bons-achados.png"
            alt=""
            width={40}
            height={40}
            className="shrink-0 rounded-full"
            priority
          />
          <div>
            <p className="font-mono text-[10px] tracking-[0.22em] text-ash uppercase">
              Bons Achados
            </p>
            <p className="font-display font-stretch-condensed text-lg leading-none font-black text-ink uppercase italic">
              Ofertas de hoje
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
        <form method="get" className="mb-8 flex flex-wrap items-center gap-x-6 gap-y-3">
          <input type="hidden" name="filtered" value="1" />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {ALL_MARKETPLACES.map((marketplace) => (
              <label key={marketplace} className="flex items-center gap-2 text-sm text-ink/80">
                <input
                  type="checkbox"
                  name="marketplace"
                  value={marketplace}
                  defaultChecked={marketplaces.includes(marketplace)}
                  className="size-4 rounded border-ink/30 text-ink focus-visible:ring-2 focus-visible:ring-ink/40"
                />
                {MARKETPLACE_LABEL[marketplace]}
              </label>
            ))}
          </div>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <label htmlFor="vitrine-q" className="sr-only">
              Buscar por nome
            </label>
            <input
              id="vitrine-q"
              type="text"
              name="q"
              defaultValue={q}
              placeholder="Buscar por nome…"
              className="min-w-0 flex-1 rounded-full border border-ink/15 bg-white px-4 py-2 text-sm text-ink placeholder:text-ink/40 focus-visible:border-ink focus-visible:ring-2 focus-visible:ring-ink/30 focus-visible:outline-none"
            />
            <button
              type="submit"
              className="rounded-full bg-ink px-5 py-2 font-display font-stretch-condensed text-xs font-black tracking-wide text-gold uppercase italic transition hover:bg-ink-raised focus-visible:ring-2 focus-visible:ring-ink focus-visible:outline-none"
            >
              Filtrar
            </button>
          </div>
        </form>

        <VitrineHighlights highlights={items} />

        {(page > 1 || hasNextPage) && (
          <div className="mt-10 flex items-center justify-center gap-4">
            {page > 1 && (
              <a
                href={buildPageHref(page - 1, marketplaces, q, filtered)}
                className="rounded-full border border-ink/15 px-5 py-2 font-mono text-xs tracking-wider text-ink uppercase transition hover:border-ink focus-visible:ring-2 focus-visible:ring-ink/40 focus-visible:outline-none"
              >
                Página anterior
              </a>
            )}
            {hasNextPage && (
              <a
                href={buildPageHref(page + 1, marketplaces, q, filtered)}
                className="rounded-full border border-ink/15 px-5 py-2 font-mono text-xs tracking-wider text-ink uppercase transition hover:border-ink focus-visible:ring-2 focus-visible:ring-ink/40 focus-visible:outline-none"
              >
                Próxima página
              </a>
            )}
          </div>
        )}
      </main>

      <footer className="border-t border-ink/10">
        <div className="mx-auto max-w-5xl px-6 py-6">
          <p className="text-xs text-ink/60">
            Como associado da Amazon, eu recebo por compras qualificadas.
          </p>
        </div>
      </footer>
    </div>
  );
}
```

Note the checkboxes use `defaultChecked` (not `checked`) since this is a plain `<form method="get">` with no client-side state — the browser owns the checked state between the initial render and submit; React only needs to set the *initial* value from the URL each time the Server Component re-renders after navigation.

- [ ] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint src/app/page.tsx`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat: paginate, filter, and search the public vitrine over the shared pool"
```

---

### Task 17: Remove the `/admin/vitrine` page and its nav entry

**Files:**
- Delete: `src/app/admin/vitrine/page.tsx`
- Delete: `src/app/admin/vitrine/VitrineAdmin.tsx`
- Modify: `src/app/admin/AdminNav.tsx`

**Interfaces:**
- Consumes: none
- Produces: none — this task only removes dead UI. `GET /api/admin/highlights` and `DELETE /api/admin/highlights/[id]` (the routes this page used) stay, now used directly by the three hub pages instead (Tasks 13-15).

- [ ] **Step 1: Delete the page**

```bash
rm -rf src/app/admin/vitrine
```

- [ ] **Step 2: Remove its nav entry**

In `src/app/admin/AdminNav.tsx`, remove the `{ href: "/admin/vitrine", label: "Vitrine" },` line from the `LINKS` array. The array should read:

```typescript
const LINKS = [
  { href: "/admin", label: "Painel" },
  { href: "/admin/mercadolivre", label: "Hub Mercado Livre" },
  { href: "/admin/amazon", label: "Hub Amazon" },
  { href: "/admin/shopee", label: "Hub Shopee" },
  { href: "/admin/postar", label: "Postar" },
];
```

- [ ] **Step 3: Check for other references**

Run: `grep -rn "admin/vitrine\|VitrineAdmin" src tests --include="*.ts" --include="*.tsx"`
Expected: no matches (confirms nothing else links to or imports the removed page).

- [ ] **Step 4: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint src/app/admin/AdminNav.tsx`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/AdminNav.tsx
git rm -r src/app/admin/vitrine
git commit -m "refactor: remove the standalone vitrine curation page, hubs cover it now"
```

---

### Task 18: GitHub Actions workflows + `.env.example`

**Files:**
- Modify: `.github/workflows/highlights-cleanup.yml`
- Create: `.github/workflows/collect.yml`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `POST /api/cron/highlights-cleanup` (existing, unmodified route), `POST /api/cron/collect` (Task 11)
- Produces: none new — YAML workflow files aren't covered by the Vitest suite in this repo (same as the two existing cron workflows, which also have no test file — only their route handlers do, already covered by Task 11's tests).

- [ ] **Step 1: Move the cleanup schedule to 5am and chain the collect call**

Replace `.github/workflows/highlights-cleanup.yml` with:

```yaml
name: Highlights cleanup

on:
  schedule:
    - cron: "0 8 * * *" # 05:00 America/Sao_Paulo (fixed UTC-3, no DST)
  workflow_dispatch: {}

jobs:
  cleanup:
    runs-on: ubuntu-latest
    steps:
      - name: Call the cleanup endpoint
        run: |
          curl -sf -X POST "${{ secrets.APP_URL }}/api/cron/highlights-cleanup" \
            -H "Authorization: Bearer ${{ secrets.HIGHLIGHTS_CLEANUP_SECRET }}"
      - name: Repopulate immediately after cleanup
        run: |
          response=$(curl -sf -X POST "${{ secrets.APP_URL }}/api/cron/collect" \
            -H "Authorization: Bearer ${{ secrets.CRON_COLLECT_SECRET }}")
          echo "$response"
          if echo "$response" | grep -q '"error"'; then
            echo "::error::One or more marketplaces failed to collect after cleanup"
            exit 1
          fi
```

The 5am cutoff moves the cleanup earlier than the old midnight-based schedule (`"0 3 * * *"`, 00:00 BRT) — `8 * * *` UTC is 05:00 BRT (fixed UTC-3 offset, same no-DST assumption already used by every other workflow in this repo).

- [ ] **Step 2: Add the periodic collection workflow**

Create `.github/workflows/collect.yml`:

```yaml
name: Collect highlights

on:
  schedule:
    - cron: "*/20 * * * *"
  workflow_dispatch: {}

jobs:
  collect:
    runs-on: ubuntu-latest
    steps:
      - name: Call the collect endpoint
        run: |
          response=$(curl -sf -X POST "${{ secrets.APP_URL }}/api/cron/collect" \
            -H "Authorization: Bearer ${{ secrets.CRON_COLLECT_SECRET }}")
          echo "$response"
          if echo "$response" | grep -q '"error"'; then
            echo "::error::One or more marketplaces failed to collect"
            exit 1
          fi
```

A failed step here (or in the cleanup workflow's second step) shows up as a red run in GitHub Actions and triggers GitHub's built-in failure-notification email — the "alerta de sessão expirada" the spec calls for, with no new channel to build.

- [ ] **Step 3: Document the new secret**

In `.env.example`, add this block right after the `HIGHLIGHTS_CLEANUP_SECRET` block:

```
# Bearer secret both GitHub Actions crons (collect.yml every 20 min, and the
# second step of highlights-cleanup.yml) send to /api/cron/collect. The same
# value must also be set as the GitHub repo secret CRON_COLLECT_SECRET (see
# .github/workflows/collect.yml) and as a Vercel env var for the cron to
# actually run in production.
CRON_COLLECT_SECRET="change-me"
```

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/highlights-cleanup.yml .github/workflows/collect.yml .env.example
git commit -m "feat: run the collection pipeline every 20 minutes and after the 5am cleanup"
```

---

### Task 19: Full test suite, lint, and manual verification

**Files:** none (verification only)

**Interfaces:** none

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: all tests pass, including every new `tests/collect/*`, `tests/api/cron/collect.test.ts`, and every modified test file from Tasks 1-17.

- [ ] **Step 2: Type-check and lint the whole project**

Run: `npx tsc --noEmit && npx eslint .`
Expected: no errors.

- [ ] **Step 3: Confirm no leftover references to removed code**

Run: `grep -rln "MercadoLivreGeneratedLink\|generate-link\|listTodaysHighlights()\|VitrineAdmin\|admin/vitrine" src tests --include="*.ts" --include="*.tsx"`
Expected: no matches (the last one, `listTodaysHighlights()` with no args as a literal substring, is just a sanity grep for stray old-style calls — `listTodaysHighlights(marketplace)` calls are fine and won't match this pattern since grep is substring-based here; skip this check if it produces false positives from Task 12's route calling `listTodaysHighlights(parseMarketplace(request))`, which also won't match).

- [ ] **Step 4: Run the migration against the real database**

Run: `npx prisma migrate deploy` (or `npx prisma migrate dev` if working against a personal dev database) and confirm it applies cleanly, then `npx prisma studio` (or a direct query) to confirm the `Highlight` table now has a `productId` column and no old rows, and that `Product`/`MercadoLivreGeneratedLink` tables are gone.

- [ ] **Step 5: Trigger collection manually and confirm the pool fills**

1. Start the dev server: `npm run dev`.
2. Set `CRON_COLLECT_SECRET` in `.env` to match what you'll send.
3. Run: `curl -X POST http://localhost:3000/api/cron/collect -H "Authorization: Bearer $CRON_COLLECT_SECRET"`
4. Confirm the JSON response shows `inserted > 0` for at least the marketplaces with a valid session/API key, and `error` set for any marketplace missing a session (expected if you haven't pasted a fresh ML/Amazon curl yet in this environment).
5. Confirm via `npx prisma studio` (or a query) that `Highlight` rows now exist with `productId`, `note`, and a working `affiliateLink`.

- [ ] **Step 6: Verify the public vitrine**

1. Open `/` and confirm up to 30 items appear, each with an image, price, note, and a working affiliate link (`target="_blank"`, `rel="sponsored"`).
2. If more than 30 rows exist in the pool, confirm "Próxima página" appears and moves to page 2 with different items, and "Página anterior" returns to page 1.
3. Check only "Shopee" and submit — confirm only Shopee items appear. Check "Shopee" + "Mercado Livre" — confirm Amazon items disappear. Uncheck everything and submit — confirm the list is empty (not "show everything").
4. Type a term from one of the pooled titles into the search box and submit — confirm only matching titles appear, combined correctly with whatever marketplace filter is also checked.

- [ ] **Step 7: Verify each admin hub**

1. Log in to `/admin` and open `/admin/mercadolivre`, `/admin/amazon`, `/admin/shopee` in turn.
2. Confirm each one shows the pool items for its marketplace immediately on load (no "Destacar na vitrine" button anywhere, no note textarea).
3. On the ML and Shopee hubs, search a term and confirm new items appear both in the hub grid and (after a refresh) on the public vitrine.
4. On the Amazon hub, click "Carregar mais" and confirm it live-fetches, persists, and appends new cards without duplicating any already shown.
5. Click "Selecionar para postar" on one item in each hub and confirm it shows up in `/admin/postar`.
6. Click "Remover da vitrine" on one item in each hub and confirm it disappears from that hub's grid, and (after a refresh) from the public vitrine too.

- [ ] **Step 8: Verify the cleanup + repopulate chain**

Run: `curl -X POST http://localhost:3000/api/cron/highlights-cleanup -H "Authorization: Bearer $HIGHLIGHTS_CLEANUP_SECRET"` and confirm it only deletes rows older than today's 5am cutoff, leaving today's pool intact (create a fresh item first via Step 5 if the pool would otherwise be empty).

- [ ] **Step 9: Confirm the GitHub Actions workflows**

Confirm `.github/workflows/collect.yml` (every 20 min) and the updated `.github/workflows/highlights-cleanup.yml` (05:00 BRT, two chained steps) are present, and that the repo has `APP_URL`, `HIGHLIGHTS_CLEANUP_SECRET`, and the new `CRON_COLLECT_SECRET` set as GitHub Actions secrets (and as Vercel env vars) before merging — the workflows will 401 without them.

- [ ] **Step 10: Report results**

If all steps pass, the feature is complete. If any step fails, use the systematic-debugging skill before making further changes.
