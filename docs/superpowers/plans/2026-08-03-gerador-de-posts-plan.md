# Gerador de Posts (Stories + Carrossel) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the standalone Python post-generator (Stories with brand frame + price pill, feed slides with badge, carousel caption) into the admin panel, fed by a new manual product form and by "select for posting" on the Mercado Livre hub, with same-day duplicate detection and a manual "clear list" flow.

**Architecture:** A new `PostDraft` Prisma table (independent from `Product`, which is reserved for the future score/Telegram/site pipeline) holds the daily posting queue. Image composition happens on demand in API route handlers using Sharp (resize/composite) and `@napi-rs/canvas` (the price pill's rounded rect + text, which Sharp can't draw) — nothing is written to disk/storage. A GitHub Actions cron purges stale (previous-day) rows nightly so same-day duplicate detection resets.

**Tech Stack:** Next.js App Router route handlers, Prisma/PostgreSQL, Sharp, `@napi-rs/canvas`, Vitest.

## Global Constraints

- All code, identifiers, comments, and commit messages are in English, even though this plan and chat are in Portuguese (project convention).
- This is a customized Next.js version ("This is NOT the Next.js you know" — `AGENTS.md`). Route handler dynamic segments use `params: Promise<{...}>` — confirmed against `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md`. Check that directory before diverging from any pattern in this plan.
- TDD: write the failing test before the implementation for every `src/lib/**` module. UI pages/components in this repo have no unit tests today (confirmed: no `@testing-library/react` dependency, no component test files) — verify those with `npm run build`, `npm run lint`, and a visual check instead, matching how `LoginForm.tsx`/`MercadoLivreAdmin.tsx` were built.
- `PostDraft` is a new, independent table — do not modify the `Product` model or any of its existing routes/tests.
- Only the diagonal story moldura and the 1080×1350 feed slide are in scope (no lateral moldura, no 1080×1080 feed variant).
- No generated image or caption is ever persisted to disk or blob storage — everything is computed per request.
- Timezone for "today" is America/Sao_Paulo, fixed UTC-3 (Brazil has not observed DST since 2019 — do not use a DST-aware timezone library for this, a fixed offset is correct and simpler).
- Run `npm run test` (vitest) and `npm run lint` after every task; both must pass before moving on.

---

### Task 1: `PostDraft` Prisma model + migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_post_draft/migration.sql` (generated, not hand-written)

**Interfaces:**
- Produces: Prisma model `PostDraft` with fields `id, marketplace, source, title, affiliateLink, image, price, discount, category, createdAt, postedAt`, reusing the existing `Marketplace` and `ProductSource` enums. Every later task's Prisma calls (`prisma.postDraft.*`) depend on this.

- [ ] **Step 1: Add the model to the schema**

Append to `prisma/schema.prisma` (after the `MercadoLivreGeneratedLink` model, keeping the existing enums untouched):

```prisma
model PostDraft {
  id            String        @id @default(cuid())
  marketplace   Marketplace
  source        ProductSource
  title         String
  affiliateLink String
  image         String
  price         Float
  discount      Float?
  category      String?
  createdAt     DateTime      @default(now())
  postedAt      DateTime?

  @@index([affiliateLink, createdAt])
}
```

- [ ] **Step 2: Generate and apply the migration**

This talks to the real database configured in `.env` (`DATABASE_URL`) — confirm with the user before running if there is any doubt about which database that points to.

Run: `npx prisma migrate dev --name add_post_draft`

Expected: a new folder under `prisma/migrations/` containing a `migration.sql` that only adds the `PostDraft` table (no changes to `Product`, `MercadoLivreSession`, or `MercadoLivreGeneratedLink`); command exits 0.

- [ ] **Step 3: Verify the Prisma client picks up the new model**

Run: `npx prisma generate`
Then: `node -e "const {PrismaClient} = require('@prisma/client'); const p = new PrismaClient(); console.log(typeof p.postDraft.create)"`
Expected: prints `function`.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat: add PostDraft table for the post generator queue"
```

---

### Task 2: `categorize()` — keyword-based category suggestion

**Files:**
- Create: `src/lib/postdraft/categorize.ts`
- Test: `tests/lib/postdraft/categorize.test.ts`

**Interfaces:**
- Produces: `categorize(name: string): string`, returning one of `"suplemento" | "roupa" | "casa" | "beleza" | "fitness" | "bebida" | "outro"`. Used by Task 4 (`store.ts`) to fill `PostDraft.category` when the caller doesn't supply one.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/lib/postdraft/categorize.test.ts
import { describe, it, expect } from "vitest";
import { categorize } from "@/lib/postdraft/categorize";

describe("categorize", () => {
  it("matches a suplemento keyword", () => {
    expect(categorize("Creatina 1kg Suplemento Monohidratada")).toBe("suplemento");
  });

  it("matches a roupa keyword", () => {
    expect(categorize("Calça Jeans Flare Feminina Cintura Alta")).toBe("roupa");
  });

  it("matches a casa keyword", () => {
    expect(categorize("Fritadeira Elétrica Air Fryer 5L")).toBe("casa");
  });

  it("is case- and accent-insensitive", () => {
    expect(categorize("AR CONDICIONADO COM SERÚM Facial")).toBe("beleza");
  });

  it("falls back to outro when nothing matches", () => {
    expect(categorize("Cabo USB-C 2 metros")).toBe("outro");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/postdraft/categorize.test.ts`
Expected: FAIL with "Cannot find module '@/lib/postdraft/categorize'".

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/postdraft/categorize.ts
const CATEGORY_KEYWORDS: Array<[string, string[]]> = [
  ["suplemento", ["creatina", "suplemento", "whey", "proteina", "bcaa"]],
  [
    "roupa",
    ["camiseta", "camisetas", "cueca", "cuecas", "bermuda", "shorts", "body", "calca", "vestido"],
  ],
  [
    "casa",
    [
      "fritadeira",
      "micro-ondas",
      "microondas",
      "sanduicheira",
      "pote",
      "potes",
      "filtro de agua",
      "papel higienico",
      "camera",
      "lampada",
    ],
  ],
  [
    "beleza",
    ["serum", "niacinamida", "escova secadora", "aparador de pelos", "kit essencial"],
  ],
  ["fitness", ["bicicleta", "spinning", "ergometrica", "esteira"]],
  ["bebida", ["cerveja", "heineken", "refrigerante", "vinho"]],
];

function normalize(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

export function categorize(name: string): string {
  const normalized = normalize(name);
  for (const [category, keywords] of CATEGORY_KEYWORDS) {
    for (const keyword of keywords) {
      if (normalized.includes(keyword)) {
        return category;
      }
    }
  }
  return "outro";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/postdraft/categorize.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/postdraft/categorize.ts tests/lib/postdraft/categorize.test.ts
git commit -m "feat: add keyword-based category suggestion for post drafts"
```

---

### Task 3: `buildCaption()` — carousel caption text

**Files:**
- Create: `src/lib/postdraft/caption.ts`
- Test: `tests/lib/postdraft/caption.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `type CaptionProduct = { title: string; marketplace: "MERCADO_LIVRE" | "AMAZON" | "SHOPEE"; category: string | null; discount: number | null }` and `buildCaption(products: CaptionProduct[]): string`. Used by Task 6 (`GET /api/admin/postdraft`) to build the caption returned alongside the queue.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/lib/postdraft/caption.test.ts
import { describe, it, expect } from "vitest";
import { buildCaption, type CaptionProduct } from "@/lib/postdraft/caption";

describe("buildCaption", () => {
  it("numbers each product with its discount and appends hashtags", () => {
    const products: CaptionProduct[] = [
      { title: "Creatina 1kg Suplemento", marketplace: "MERCADO_LIVRE", category: "suplemento", discount: 72 },
      { title: "Air Fryer 5L", marketplace: "AMAZON", category: "casa", discount: null },
    ];

    const caption = buildCaption(products);

    expect(caption).toContain("🔥 1. Creatina 1kg Suplemento — 72% OFF");
    expect(caption).toContain("🔥 2. Air Fryer 5L — imperdivel");
    expect(caption).toContain("#mercadolivre");
    expect(caption).toContain("#amazon");
    expect(caption).toContain("#suplementos");
    expect(caption).toContain("#casa");
    expect(caption).toContain("#bonsachados");
  });

  it("truncates long titles at a word boundary and drops anything after ' | '", () => {
    const longTitle =
      "Fone de Ouvido Bluetooth 5.4 com Cancelamento de Ruído Adaptativo e Estojo | Cor Preta";
    const products: CaptionProduct[] = [
      { title: longTitle, marketplace: "AMAZON", category: null, discount: 10 },
    ];

    const caption = buildCaption(products);

    expect(caption).not.toContain("Cor Preta");
    expect(caption).toContain("...");
  });

  it("does not duplicate a hashtag shared by two products", () => {
    const products: CaptionProduct[] = [
      { title: "Camiseta A", marketplace: "MERCADO_LIVRE", category: "roupa", discount: 20 },
      { title: "Camiseta B", marketplace: "MERCADO_LIVRE", category: "roupa", discount: 30 },
    ];

    const caption = buildCaption(products);
    const occurrences = caption.split("#mercadolivre").length - 1;

    expect(occurrences).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/postdraft/caption.test.ts`
Expected: FAIL with "Cannot find module '@/lib/postdraft/caption'".

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/postdraft/caption.ts
export type CaptionProduct = {
  title: string;
  marketplace: "MERCADO_LIVRE" | "AMAZON" | "SHOPEE";
  category: string | null;
  discount: number | null;
};

const BASE_HASHTAGS = [
  "#achados",
  "#promocao",
  "#promocoes",
  "#ofertas",
  "#ofertadodia",
  "#descontos",
  "#compraonline",
  "#bonsachados",
];

const MARKETPLACE_HASHTAGS: Record<CaptionProduct["marketplace"], string> = {
  MERCADO_LIVRE: "#mercadolivre",
  AMAZON: "#amazon",
  SHOPEE: "#shopee",
};

const CATEGORY_HASHTAGS: Record<string, string[]> = {
  roupa: ["#moda", "#roupas"],
  suplemento: ["#suplementos", "#fitness"],
  casa: ["#casa", "#organizacao"],
  beleza: ["#beleza"],
  fitness: ["#fitness", "#treino"],
  bebida: ["#bebidas"],
};

function shortName(name: string, maxLength = 60): string {
  const head = name.split(" | ")[0].trim();
  if (head.length <= maxLength) {
    return head;
  }
  const cut = head.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace === -1 ? cut : cut.slice(0, lastSpace)).trim()}...`;
}

function discountText(discount: number | null): string {
  return discount ? `${discount}% OFF` : "imperdivel";
}

export function buildCaption(products: CaptionProduct[]): string {
  const lines = ["🚨 ALERTA DE PROMOÇÃO 🚨", ""];
  products.forEach((product, index) => {
    lines.push(`🔥 ${index + 1}. ${shortName(product.title)} — ${discountText(product.discount)}`);
  });
  lines.push("");
  lines.push("Corre que promoção boa não espera 🏃‍♂️💨");
  lines.push("👉 Link de cada produto nos Stories");
  lines.push("");

  const hashtags = [...BASE_HASHTAGS];

  const marketplaces = new Set(products.map((product) => product.marketplace));
  for (const marketplace of marketplaces) {
    const tag = MARKETPLACE_HASHTAGS[marketplace];
    if (tag && !hashtags.includes(tag)) {
      hashtags.push(tag);
    }
  }

  const categories = new Set(
    products.map((product) => product.category).filter((category): category is string => Boolean(category))
  );
  for (const category of categories) {
    for (const tag of CATEGORY_HASHTAGS[category] ?? []) {
      if (!hashtags.includes(tag)) {
        hashtags.push(tag);
      }
    }
  }

  lines.push(hashtags.join(" "));
  return `${lines.join("\n")}\n`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/postdraft/caption.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/postdraft/caption.ts tests/lib/postdraft/caption.test.ts
git commit -m "feat: add carousel caption builder"
```

---

### Task 4: `PostDraft` store — create (with same-day dedup), list, clear, delete stale

**Files:**
- Create: `src/lib/postdraft/store.ts`
- Test: `tests/lib/postdraft/store.test.ts`

**Interfaces:**
- Consumes: `categorize` from Task 2 (`@/lib/postdraft/categorize`), `prisma` from `@/lib/prisma`.
- Produces:
  - `type CreatePostDraftInput = { marketplace: Marketplace; source: ProductSource; title: string; affiliateLink: string; image: string; price: number; discount: number | null; category: string | null }`
  - `type CreatePostDraftResult = { status: "created"; id: string; category: string } | { status: "duplicate"; createdAt: Date }`
  - `createPostDraft(input: CreatePostDraftInput): Promise<CreatePostDraftResult>`
  - `listActivePostDrafts(): Promise<PostDraft[]>` (Prisma's generated `PostDraft` type)
  - `clearActivePostDrafts(): Promise<number>`
  - `deleteStalePostDrafts(): Promise<number>`
  - `getPostDraftById(id: string): Promise<PostDraft | null>`
  All of these are consumed directly by the API routes in Tasks 6, 7, 8, 9.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/lib/postdraft/store.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    postDraft: {
      findFirst: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/prisma";
import {
  createPostDraft,
  listActivePostDrafts,
  clearActivePostDrafts,
  deleteStalePostDrafts,
  getPostDraftById,
} from "@/lib/postdraft/store";

const BASE_INPUT = {
  marketplace: "MERCADO_LIVRE" as const,
  source: "AUTO" as const,
  title: "Creatina 1kg Suplemento",
  affiliateLink: "https://meli.la/abc",
  image: "https://img.example/1.webp",
  price: 59.9,
  discount: 25,
  category: null,
};

describe("createPostDraft", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-03T15:00:00.000Z")); // 12:00 in America/Sao_Paulo
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("creates a row and auto-categorizes when category is not supplied", async () => {
    vi.mocked(prisma.postDraft.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.postDraft.create).mockResolvedValue({ id: "cd1" } as never);

    const result = await createPostDraft(BASE_INPUT);

    expect(result).toEqual({ status: "created", id: "cd1", category: "suplemento" });
    expect(prisma.postDraft.create).toHaveBeenCalledWith({
      data: { ...BASE_INPUT, category: "suplemento" },
    });
  });

  it("keeps an explicitly supplied category", async () => {
    vi.mocked(prisma.postDraft.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.postDraft.create).mockResolvedValue({ id: "cd2" } as never);

    const result = await createPostDraft({ ...BASE_INPUT, category: "outro" });

    expect(result).toEqual({ status: "created", id: "cd2", category: "outro" });
  });

  it("returns duplicate when the same affiliateLink was created today, without creating a row", async () => {
    const createdAt = new Date("2026-08-03T13:00:00.000Z");
    vi.mocked(prisma.postDraft.findFirst).mockResolvedValue({ createdAt } as never);

    const result = await createPostDraft(BASE_INPUT);

    expect(result).toEqual({ status: "duplicate", createdAt });
    expect(prisma.postDraft.create).not.toHaveBeenCalled();
  });

  it("scopes the duplicate lookup to the start of today in America/Sao_Paulo", async () => {
    vi.mocked(prisma.postDraft.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.postDraft.create).mockResolvedValue({ id: "cd3" } as never);

    await createPostDraft(BASE_INPUT);

    expect(prisma.postDraft.findFirst).toHaveBeenCalledWith({
      where: {
        affiliateLink: BASE_INPUT.affiliateLink,
        createdAt: { gte: new Date("2026-08-03T03:00:00.000Z") }, // 00:00 BRT = 03:00 UTC
      },
      orderBy: { createdAt: "desc" },
    });
  });
});

describe("listActivePostDrafts", () => {
  it("lists postDraft rows with postedAt null, newest first", async () => {
    vi.mocked(prisma.postDraft.findMany).mockResolvedValue([] as never);

    await listActivePostDrafts();

    expect(prisma.postDraft.findMany).toHaveBeenCalledWith({
      where: { postedAt: null },
      orderBy: { createdAt: "desc" },
    });
  });
});

describe("clearActivePostDrafts", () => {
  it("marks all active rows as posted and returns the count", async () => {
    vi.mocked(prisma.postDraft.updateMany).mockResolvedValue({ count: 4 } as never);

    const count = await clearActivePostDrafts();

    expect(prisma.postDraft.updateMany).toHaveBeenCalledWith({
      where: { postedAt: null },
      data: { postedAt: expect.any(Date) },
    });
    expect(count).toBe(4);
  });
});

describe("deleteStalePostDrafts", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-03T15:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("deletes rows created before the start of today in America/Sao_Paulo", async () => {
    vi.mocked(prisma.postDraft.deleteMany).mockResolvedValue({ count: 7 } as never);

    const count = await deleteStalePostDrafts();

    expect(prisma.postDraft.deleteMany).toHaveBeenCalledWith({
      where: { createdAt: { lt: new Date("2026-08-03T03:00:00.000Z") } },
    });
    expect(count).toBe(7);
  });
});

describe("getPostDraftById", () => {
  it("looks up a single row by id", async () => {
    vi.mocked(prisma.postDraft.findUnique).mockResolvedValue({ id: "cd1" } as never);

    const result = await getPostDraftById("cd1");

    expect(prisma.postDraft.findUnique).toHaveBeenCalledWith({ where: { id: "cd1" } });
    expect(result).toEqual({ id: "cd1" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/postdraft/store.test.ts`
Expected: FAIL with "Cannot find module '@/lib/postdraft/store'".

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/postdraft/store.ts
import type { Marketplace, PostDraft, ProductSource } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { categorize } from "@/lib/postdraft/categorize";

const BRAZIL_UTC_OFFSET_MS = -3 * 60 * 60 * 1000; // fixed offset, Brazil has not observed DST since 2019

function startOfTodayInBrazil(now: Date = new Date()): Date {
  const brazilNow = new Date(now.getTime() + BRAZIL_UTC_OFFSET_MS);
  const startOfDayBrazilMs = Date.UTC(
    brazilNow.getUTCFullYear(),
    brazilNow.getUTCMonth(),
    brazilNow.getUTCDate()
  );
  return new Date(startOfDayBrazilMs - BRAZIL_UTC_OFFSET_MS);
}

export type CreatePostDraftInput = {
  marketplace: Marketplace;
  source: ProductSource;
  title: string;
  affiliateLink: string;
  image: string;
  price: number;
  discount: number | null;
  category: string | null;
};

export type CreatePostDraftResult =
  | { status: "created"; id: string; category: string }
  | { status: "duplicate"; createdAt: Date };

export async function createPostDraft(input: CreatePostDraftInput): Promise<CreatePostDraftResult> {
  const existing = await prisma.postDraft.findFirst({
    where: {
      affiliateLink: input.affiliateLink,
      createdAt: { gte: startOfTodayInBrazil() },
    },
    orderBy: { createdAt: "desc" },
  });
  if (existing) {
    return { status: "duplicate", createdAt: existing.createdAt };
  }

  const category = input.category ?? categorize(input.title);
  const created = await prisma.postDraft.create({
    data: { ...input, category },
  });
  return { status: "created", id: created.id, category };
}

export async function listActivePostDrafts(): Promise<PostDraft[]> {
  return prisma.postDraft.findMany({
    where: { postedAt: null },
    orderBy: { createdAt: "desc" },
  });
}

export async function clearActivePostDrafts(): Promise<number> {
  const result = await prisma.postDraft.updateMany({
    where: { postedAt: null },
    data: { postedAt: new Date() },
  });
  return result.count;
}

export async function deleteStalePostDrafts(): Promise<number> {
  const result = await prisma.postDraft.deleteMany({
    where: { createdAt: { lt: startOfTodayInBrazil() } },
  });
  return result.count;
}

export async function getPostDraftById(id: string): Promise<PostDraft | null> {
  return prisma.postDraft.findUnique({ where: { id } });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/postdraft/store.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/postdraft/store.ts tests/lib/postdraft/store.test.ts
git commit -m "feat: add PostDraft store with same-day duplicate detection"
```

---

### Task 5: Brand assets, font, and image composition (`postdraft/images.ts`)

**Files:**
- Already present (added ahead of this task): `assets/brand-kit/MOLDURA_diagonal_story_1080x1920.png` — verify it exists before proceeding, do not recreate or replace it.
- Create: `assets/brand-kit/SELO_70pct_400px.png` (binary, copied)
- Create: `assets/fonts/ArchivoBlack-Regular.ttf` (binary, downloaded)
- Create: `src/lib/postdraft/images.ts`
- Test: `tests/lib/postdraft/images.test.ts`
- Modify: `package.json` (add `sharp`, `@napi-rs/canvas` dependencies)

**Interfaces:**
- Produces:
  - `fetchImageBuffer(url: string): Promise<Buffer>`
  - `loadMolduraDiagonalStory(): Buffer`
  - `loadSelo(): Buffer`
  - `composeStory(productImage: Buffer, molduraImage: Buffer, price: number): Promise<Buffer>` — returns a JPEG buffer, 1080×1920.
  - `composeFeedSlide(productImage: Buffer, seloImage: Buffer): Promise<Buffer>` — returns a JPEG buffer, 1080×1350.
  Consumed by Task 8 (`GET /api/admin/postdraft/[id]/story` and `.../feed` routes).

- [ ] **Step 1: Install the image dependencies**

Run: `npm install sharp @napi-rs/canvas`
Expected: both added to `package.json` `dependencies`, `npm run build` still succeeds afterward (run it to confirm no native-binary install errors).

- [ ] **Step 2: Copy the brand assets**

`assets/brand-kit/MOLDURA_diagonal_story_1080x1920.png` was already added directly to the
repo (a revised moldura design, replacing the one from the standalone Python project —
white/transparent center, diagonal "OFERTA" corner, bottom bar with logo and legal
disclaimer, no price-pill space reserved in the graphic itself). If it is not already
present, stop and ask — do not substitute the old Python project's moldura file. Only the
selo still needs copying:

```bash
mkdir -p assets/brand-kit assets/fonts
cp ~/Documentos/Produtos/molduras/SELO_70pct_400px.png assets/brand-kit/
```

Expected: both files present under `assets/brand-kit/`, `MOLDURA_diagonal_story_1080x1920.png`
is exactly 1080×1920px, RGBA with a transparent center (`file assets/brand-kit/MOLDURA_diagonal_story_1080x1920.png`
should report `1080 x 1920` and `PNG image data, ... RGBA`).

- [ ] **Step 3: Download the price-pill font**

`@napi-rs/canvas` needs a real font file on disk to register (fonts loaded via `next/font` only exist at browser runtime, not in a server-side canvas). Use the static "Archivo Black" cut from the same type family already used across the admin UI, since a variable font's weight axis isn't guaranteed to resolve correctly through Skia's font matching:

```bash
curl -sSL -o assets/fonts/ArchivoBlack-Regular.ttf \
  "https://raw.githubusercontent.com/google/fonts/main/ofl/archivoblack/ArchivoBlack-Regular.ttf"
```

Expected: `file assets/fonts/ArchivoBlack-Regular.ttf` reports "TrueType Font data"; the file is roughly 90KB. This is an OFL-licensed Google Font — safe to bundle.

- [ ] **Step 4: Write the failing test**

```typescript
// tests/lib/postdraft/images.test.ts
import { describe, it, expect } from "vitest";
import sharp from "sharp";
import {
  composeStory,
  composeFeedSlide,
  loadMolduraDiagonalStory,
  loadSelo,
} from "@/lib/postdraft/images";

async function fakeProductImage(): Promise<Buffer> {
  return sharp({
    create: { width: 600, height: 400, channels: 3, background: { r: 200, g: 30, b: 30 } },
  })
    .png()
    .toBuffer();
}

describe("composeStory", () => {
  it("returns a 1080x1920 JPEG with the price pill composited on top of the moldura", async () => {
    const buffer = await composeStory(await fakeProductImage(), loadMolduraDiagonalStory(), 59.9);
    const metadata = await sharp(buffer).metadata();

    expect(metadata.format).toBe("jpeg");
    expect(metadata.width).toBe(1080);
    expect(metadata.height).toBe(1920);
  });
});

describe("composeFeedSlide", () => {
  it("returns a 1080x1350 JPEG with the selo composited on top", async () => {
    const buffer = await composeFeedSlide(await fakeProductImage(), loadSelo());
    const metadata = await sharp(buffer).metadata();

    expect(metadata.format).toBe("jpeg");
    expect(metadata.width).toBe(1080);
    expect(metadata.height).toBe(1350);
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `npx vitest run tests/lib/postdraft/images.test.ts`
Expected: FAIL with "Cannot find module '@/lib/postdraft/images'".

- [ ] **Step 6: Write the implementation**

```typescript
// src/lib/postdraft/images.ts
import { readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";

const BRAND_KIT_DIR = path.join(process.cwd(), "assets/brand-kit");
const FONT_PATH = path.join(process.cwd(), "assets/fonts/ArchivoBlack-Regular.ttf");
const FONT_FAMILY = "Archivo Black";

const CANVAS_BG = { r: 245, g: 245, b: 245, alpha: 1 };
const CANVAS_MARGIN_RATIO = 0.06;

const PILL_WIDTH = 356;
const PILL_HEIGHT = 113;
const PILL_COLOR = "#F9B50C";
const PILL_TEXT_COLOR = "#0D1012";
const PILL_GAP_ABOVE_BAR = 41;
// Measured from the current MOLDURA_diagonal_story_1080x1920.png: the opaque
// bottom bar (thin gold rule + logo + "@bonsachados · link na bio" + legal
// disclaimer) starts at y=1658 on a 1920px-tall canvas, so its height is
// 1920 - 1658 = 262px. Re-measure this if the moldura asset changes again.
const BAR_HEIGHT = 262;

const SELO_MARGIN_RATIO = 0.05;
const SELO_SIZE_RATIO = 0.15;

const FEED_SIZE = { width: 1080, height: 1350 };

let fontRegistered = false;
function ensureFontRegistered(): void {
  if (!fontRegistered) {
    GlobalFonts.registerFromPath(FONT_PATH, FONT_FAMILY);
    fontRegistered = true;
  }
}

let molduraCache: Buffer | null = null;
export function loadMolduraDiagonalStory(): Buffer {
  if (!molduraCache) {
    molduraCache = readFileSync(path.join(BRAND_KIT_DIR, "MOLDURA_diagonal_story_1080x1920.png"));
  }
  return molduraCache;
}

let seloCache: Buffer | null = null;
export function loadSelo(): Buffer {
  if (!seloCache) {
    seloCache = readFileSync(path.join(BRAND_KIT_DIR, "SELO_70pct_400px.png"));
  }
  return seloCache;
}

export async function fetchImageBuffer(url: string): Promise<Buffer> {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) {
    throw new Error(`Failed to fetch product image: HTTP ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function fitOnCanvas(
  productImage: Buffer,
  size: { width: number; height: number }
): Promise<Buffer> {
  const maxWidth = Math.round(size.width * (1 - 2 * CANVAS_MARGIN_RATIO));
  const maxHeight = Math.round(size.height * (1 - 2 * CANVAS_MARGIN_RATIO));

  const { data: resized, info } = await sharp(productImage)
    .resize(maxWidth, maxHeight, { fit: "inside" })
    .png()
    .toBuffer({ resolveWithObject: true });

  const left = Math.round((size.width - info.width) / 2);
  const top = Math.round((size.height - info.height) / 2);

  return sharp({
    create: { width: size.width, height: size.height, channels: 3, background: CANVAS_BG },
  })
    .composite([{ input: resized, left, top }])
    .png()
    .toBuffer();
}

async function pasteOverlay(baseImage: Buffer, overlayImage: Buffer): Promise<Buffer> {
  return sharp(baseImage).composite([{ input: overlayImage }]).png().toBuffer();
}

function formatPillPrice(price: number): string {
  return `R$ ${price.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function drawPricePillLayer(price: number, canvasWidth: number, canvasHeight: number): Buffer {
  ensureFontRegistered();
  const canvas = createCanvas(canvasWidth, canvasHeight);
  const ctx = canvas.getContext("2d");

  const x0 = Math.round((canvasWidth - PILL_WIDTH) / 2);
  const y1 = canvasHeight - BAR_HEIGHT - PILL_GAP_ABOVE_BAR;
  const y0 = y1 - PILL_HEIGHT;
  const radius = PILL_HEIGHT / 2;

  ctx.beginPath();
  ctx.moveTo(x0 + radius, y0);
  ctx.lineTo(x0 + PILL_WIDTH - radius, y0);
  ctx.arc(x0 + PILL_WIDTH - radius, y0 + radius, radius, -Math.PI / 2, 0);
  ctx.lineTo(x0 + PILL_WIDTH, y0 + PILL_HEIGHT - radius);
  ctx.arc(x0 + PILL_WIDTH - radius, y0 + PILL_HEIGHT - radius, radius, 0, Math.PI / 2);
  ctx.lineTo(x0 + radius, y0 + PILL_HEIGHT);
  ctx.arc(x0 + radius, y0 + PILL_HEIGHT - radius, radius, Math.PI / 2, Math.PI);
  ctx.lineTo(x0, y0 + radius);
  ctx.arc(x0 + radius, y0 + radius, radius, Math.PI, Math.PI * 1.5);
  ctx.closePath();
  ctx.fillStyle = PILL_COLOR;
  ctx.fill();

  ctx.fillStyle = PILL_TEXT_COLOR;
  ctx.font = `54px "${FONT_FAMILY}"`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(formatPillPrice(price), x0 + PILL_WIDTH / 2, y0 + PILL_HEIGHT / 2);

  return canvas.toBuffer("image/png");
}

async function drawPricePill(canvasImage: Buffer, price: number): Promise<Buffer> {
  const metadata = await sharp(canvasImage).metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  const pillLayer = drawPricePillLayer(price, width, height);
  return sharp(canvasImage).composite([{ input: pillLayer }]).png().toBuffer();
}

async function pasteSelo(canvasImage: Buffer, seloImage: Buffer): Promise<Buffer> {
  const canvasMeta = await sharp(canvasImage).metadata();
  const canvasWidth = canvasMeta.width ?? 0;
  const canvasHeight = canvasMeta.height ?? 0;
  const shortSide = Math.min(canvasWidth, canvasHeight);
  const size = Math.round(shortSide * SELO_SIZE_RATIO);
  const margin = Math.round(canvasWidth * SELO_MARGIN_RATIO);

  const resizedSelo = await sharp(seloImage).resize(size, size).png().toBuffer();
  const left = canvasWidth - margin - size;
  const top = canvasHeight - margin - size;

  return sharp(canvasImage).composite([{ input: resizedSelo, left, top }]).png().toBuffer();
}

export async function composeStory(
  productImage: Buffer,
  molduraImage: Buffer,
  price: number
): Promise<Buffer> {
  const molduraMeta = await sharp(molduraImage).metadata();
  const size = { width: molduraMeta.width ?? 1080, height: molduraMeta.height ?? 1920 };

  let canvas = await fitOnCanvas(productImage, size);
  canvas = await pasteOverlay(canvas, molduraImage);
  canvas = await drawPricePill(canvas, price);

  return sharp(canvas).jpeg({ quality: 90 }).toBuffer();
}

export async function composeFeedSlide(productImage: Buffer, seloImage: Buffer): Promise<Buffer> {
  let canvas = await fitOnCanvas(productImage, FEED_SIZE);
  canvas = await pasteSelo(canvas, seloImage);
  return sharp(canvas).jpeg({ quality: 90 }).toBuffer();
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run tests/lib/postdraft/images.test.ts`
Expected: PASS, 2 tests. If `canvas.toBuffer("image/png")` or `ctx.arc`/`ctx.fillText` throw, check the installed version's typings at `node_modules/@napi-rs/canvas/index.d.ts` for the exact method signatures — the API shape above matches the package's documented usage as of this plan's writing but pin/adjust if the installed version differs.

- [ ] **Step 8: Commit**

```bash
git add assets/brand-kit assets/fonts src/lib/postdraft/images.ts tests/lib/postdraft/images.test.ts package.json package-lock.json
git commit -m "feat: add Sharp/napi-rs-canvas image composition for story and feed slides"
```

---

### Task 6: `GET`/`POST /api/admin/postdraft` — list queue + caption, create with dedup

**Files:**
- Create: `src/app/api/admin/postdraft/route.ts`
- Test: `tests/api/admin/postdraft/route.test.ts`

**Interfaces:**
- Consumes: `isAuthorizedAdminRequest` from `@/lib/adminSession`, `createPostDraft`/`listActivePostDrafts` from `@/lib/postdraft/store` (Task 4), `buildCaption` from `@/lib/postdraft/caption` (Task 3).
- Produces: `GET` → `{ items: PostDraft[], caption: string }`; `POST` → `201 { id, category }` on success, `409 { error: "duplicate", createdAt }` on dedup hit, `400 { error: "invalid_body" }` on bad input, `401 { error: "unauthorized" }`. Consumed by Task 11 (manual form), Task 12 (queue page), and the hub button in Task 13.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/api/admin/postdraft/route.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/postdraft/store", () => ({
  createPostDraft: vi.fn(),
  listActivePostDrafts: vi.fn(),
}));

import { GET, POST } from "@/app/api/admin/postdraft/route";
import { createPostDraft, listActivePostDrafts } from "@/lib/postdraft/store";
import { ADMIN_SESSION_COOKIE, createSessionToken } from "@/lib/adminSession";

function authHeader() {
  return { cookie: `${ADMIN_SESSION_COOKIE}=${createSessionToken()}` };
}

const VALID_BODY = {
  marketplace: "MERCADO_LIVRE",
  source: "AUTO",
  title: "Creatina 1kg",
  affiliateLink: "https://meli.la/abc",
  image: "https://img.example/1.webp",
  price: 59.9,
  discount: 25,
  category: null,
};

describe("GET /api/admin/postdraft", () => {
  beforeEach(() => {
    process.env.ADMIN_PASSWORD = "test-password";
  });
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.ADMIN_PASSWORD;
  });

  it("returns 401 when the session cookie is missing or invalid", async () => {
    const response = await GET(new NextRequest("http://localhost/api/admin/postdraft"));

    expect(response.status).toBe(401);
    expect(listActivePostDrafts).not.toHaveBeenCalled();
  });

  it("returns the active queue and a caption built from it", async () => {
    vi.mocked(listActivePostDrafts).mockResolvedValue([
      {
        id: "cd1",
        title: "Creatina 1kg",
        marketplace: "MERCADO_LIVRE",
        category: "suplemento",
        discount: 72,
      },
    ] as never);

    const response = await GET(
      new NextRequest("http://localhost/api/admin/postdraft", { headers: authHeader() })
    );
    const body = await response.json();

    expect(body.items).toHaveLength(1);
    expect(body.caption).toContain("Creatina 1kg");
    expect(body.caption).toContain("72% OFF");
  });
});

describe("POST /api/admin/postdraft", () => {
  beforeEach(() => {
    process.env.ADMIN_PASSWORD = "test-password";
  });
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.ADMIN_PASSWORD;
  });

  function buildRequest(body: unknown, headers: Record<string, string> = authHeader()) {
    return new NextRequest("http://localhost/api/admin/postdraft", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  }

  it("returns 401 when the session cookie is missing or invalid", async () => {
    const response = await POST(buildRequest(VALID_BODY, {}));

    expect(response.status).toBe(401);
    expect(createPostDraft).not.toHaveBeenCalled();
  });

  it("returns 400 for a missing required field", async () => {
    const response = await POST(buildRequest({ ...VALID_BODY, title: "" }));

    expect(response.status).toBe(400);
    expect(createPostDraft).not.toHaveBeenCalled();
  });

  it("creates a post draft and returns 201", async () => {
    vi.mocked(createPostDraft).mockResolvedValue({ status: "created", id: "cd1", category: "suplemento" });

    const response = await POST(buildRequest(VALID_BODY));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toEqual({ id: "cd1", category: "suplemento" });
  });

  it("returns 409 when createPostDraft reports a duplicate", async () => {
    const createdAt = new Date("2026-08-03T13:00:00.000Z");
    vi.mocked(createPostDraft).mockResolvedValue({ status: "duplicate", createdAt });

    const response = await POST(buildRequest(VALID_BODY));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toBe("duplicate");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api/admin/postdraft/route.test.ts`
Expected: FAIL with "Cannot find module '@/app/api/admin/postdraft/route'".

- [ ] **Step 3: Write the implementation**

```typescript
// src/app/api/admin/postdraft/route.ts
import { NextRequest, NextResponse } from "next/server";
import type { Marketplace, ProductSource } from "@prisma/client";
import { isAuthorizedAdminRequest } from "@/lib/adminSession";
import { createPostDraft, listActivePostDrafts } from "@/lib/postdraft/store";
import { buildCaption } from "@/lib/postdraft/caption";

const VALID_MARKETPLACES: Marketplace[] = ["MERCADO_LIVRE", "AMAZON", "SHOPEE"];
const VALID_SOURCES: ProductSource[] = ["AUTO", "MANUAL"];

export async function GET(request: NextRequest) {
  if (!isAuthorizedAdminRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const items = await listActivePostDrafts();
  const caption = buildCaption(
    items.map((item) => ({
      title: item.title,
      marketplace: item.marketplace,
      category: item.category,
      discount: item.discount,
    }))
  );

  return NextResponse.json({ items, caption });
}

export async function POST(request: NextRequest) {
  if (!isAuthorizedAdminRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const marketplace = body?.marketplace;
  const source = body?.source;
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const affiliateLink = typeof body?.affiliateLink === "string" ? body.affiliateLink.trim() : "";
  const image = typeof body?.image === "string" ? body.image.trim() : "";
  const price = typeof body?.price === "number" ? body.price : NaN;
  const discount = typeof body?.discount === "number" ? body.discount : null;
  const category = typeof body?.category === "string" && body.category.trim() ? body.category.trim() : null;

  if (
    !VALID_MARKETPLACES.includes(marketplace) ||
    !VALID_SOURCES.includes(source) ||
    !title ||
    !affiliateLink ||
    !image ||
    Number.isNaN(price)
  ) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const result = await createPostDraft({
    marketplace,
    source,
    title,
    affiliateLink,
    image,
    price,
    discount,
    category,
  });

  if (result.status === "duplicate") {
    return NextResponse.json({ error: "duplicate", createdAt: result.createdAt }, { status: 409 });
  }

  return NextResponse.json({ id: result.id, category: result.category }, { status: 201 });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/api/admin/postdraft/route.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/admin/postdraft/route.ts tests/api/admin/postdraft/route.test.ts
git commit -m "feat: add list/create API for the post draft queue"
```

---

### Task 7: `POST /api/admin/postdraft/clear` — clear the active queue

**Files:**
- Create: `src/app/api/admin/postdraft/clear/route.ts`
- Test: `tests/api/admin/postdraft/clear.test.ts`

**Interfaces:**
- Consumes: `isAuthorizedAdminRequest` from `@/lib/adminSession`, `clearActivePostDrafts` from `@/lib/postdraft/store` (Task 4).
- Produces: `POST` → `{ cleared: number }`. Consumed by Task 12 (queue page's "Limpar lista" button).

- [ ] **Step 1: Write the failing test**

```typescript
// tests/api/admin/postdraft/clear.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/postdraft/store", () => ({
  clearActivePostDrafts: vi.fn(),
}));

import { POST } from "@/app/api/admin/postdraft/clear/route";
import { clearActivePostDrafts } from "@/lib/postdraft/store";
import { ADMIN_SESSION_COOKIE, createSessionToken } from "@/lib/adminSession";

function authHeader() {
  return { cookie: `${ADMIN_SESSION_COOKIE}=${createSessionToken()}` };
}

describe("POST /api/admin/postdraft/clear", () => {
  beforeEach(() => {
    process.env.ADMIN_PASSWORD = "test-password";
  });
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.ADMIN_PASSWORD;
  });

  it("returns 401 without clearing when the session cookie is missing or invalid", async () => {
    const response = await POST(new NextRequest("http://localhost/api/admin/postdraft/clear", { method: "POST" }));

    expect(response.status).toBe(401);
    expect(clearActivePostDrafts).not.toHaveBeenCalled();
  });

  it("clears the active queue and returns the count", async () => {
    vi.mocked(clearActivePostDrafts).mockResolvedValue(5);

    const response = await POST(
      new NextRequest("http://localhost/api/admin/postdraft/clear", {
        method: "POST",
        headers: authHeader(),
      })
    );
    const body = await response.json();

    expect(body).toEqual({ cleared: 5 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api/admin/postdraft/clear.test.ts`
Expected: FAIL with "Cannot find module '@/app/api/admin/postdraft/clear/route'".

- [ ] **Step 3: Write the implementation**

```typescript
// src/app/api/admin/postdraft/clear/route.ts
import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedAdminRequest } from "@/lib/adminSession";
import { clearActivePostDrafts } from "@/lib/postdraft/store";

export async function POST(request: NextRequest) {
  if (!isAuthorizedAdminRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const cleared = await clearActivePostDrafts();
  return NextResponse.json({ cleared });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/api/admin/postdraft/clear.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/admin/postdraft/clear/route.ts tests/api/admin/postdraft/clear.test.ts
git commit -m "feat: add endpoint to clear the post draft queue"
```

---

### Task 8: `GET /api/admin/postdraft/[id]/story` and `.../feed` — on-demand image routes

**Files:**
- Create: `src/app/api/admin/postdraft/[id]/story/route.ts`
- Create: `src/app/api/admin/postdraft/[id]/feed/route.ts`
- Test: `tests/api/admin/postdraft/id-story.test.ts`
- Test: `tests/api/admin/postdraft/id-feed.test.ts`

**Interfaces:**
- Consumes: `isAuthorizedAdminRequest` (`@/lib/adminSession`), `getPostDraftById` (`@/lib/postdraft/store`, Task 4), `composeStory`/`composeFeedSlide`/`fetchImageBuffer`/`loadMolduraDiagonalStory`/`loadSelo` (`@/lib/postdraft/images`, Task 5).
- Produces: `GET` → `image/jpeg` binary response, or `404 { error: "not_found" }`, or `401`. Consumed by Task 12 (queue page `<img>`/download links).

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/api/admin/postdraft/id-story.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/postdraft/store", () => ({
  getPostDraftById: vi.fn(),
}));
vi.mock("@/lib/postdraft/images", () => ({
  fetchImageBuffer: vi.fn(),
  loadMolduraDiagonalStory: vi.fn(() => Buffer.from("moldura")),
  composeStory: vi.fn(),
}));

import { GET } from "@/app/api/admin/postdraft/[id]/story/route";
import { getPostDraftById } from "@/lib/postdraft/store";
import { fetchImageBuffer, composeStory } from "@/lib/postdraft/images";
import { ADMIN_SESSION_COOKIE, createSessionToken } from "@/lib/adminSession";

function authHeader() {
  return { cookie: `${ADMIN_SESSION_COOKIE}=${createSessionToken()}` };
}

describe("GET /api/admin/postdraft/[id]/story", () => {
  beforeEach(() => {
    process.env.ADMIN_PASSWORD = "test-password";
  });
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.ADMIN_PASSWORD;
  });

  it("returns 401 when the session cookie is missing or invalid", async () => {
    const response = await GET(new NextRequest("http://localhost/api/admin/postdraft/cd1/story"), {
      params: Promise.resolve({ id: "cd1" }),
    });

    expect(response.status).toBe(401);
    expect(getPostDraftById).not.toHaveBeenCalled();
  });

  it("returns 404 when the post draft does not exist", async () => {
    vi.mocked(getPostDraftById).mockResolvedValue(null);

    const response = await GET(
      new NextRequest("http://localhost/api/admin/postdraft/cd1/story", { headers: authHeader() }),
      { params: Promise.resolve({ id: "cd1" }) }
    );

    expect(response.status).toBe(404);
  });

  it("composes and returns the story JPEG", async () => {
    vi.mocked(getPostDraftById).mockResolvedValue({
      id: "cd1",
      image: "https://img.example/1.webp",
      price: 59.9,
    } as never);
    vi.mocked(fetchImageBuffer).mockResolvedValue(Buffer.from("product-image"));
    vi.mocked(composeStory).mockResolvedValue(Buffer.from("jpeg-bytes"));

    const response = await GET(
      new NextRequest("http://localhost/api/admin/postdraft/cd1/story", { headers: authHeader() }),
      { params: Promise.resolve({ id: "cd1" }) }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(composeStory).toHaveBeenCalledWith(Buffer.from("product-image"), Buffer.from("moldura"), 59.9);
  });
});
```

```typescript
// tests/api/admin/postdraft/id-feed.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/postdraft/store", () => ({
  getPostDraftById: vi.fn(),
}));
vi.mock("@/lib/postdraft/images", () => ({
  fetchImageBuffer: vi.fn(),
  loadSelo: vi.fn(() => Buffer.from("selo")),
  composeFeedSlide: vi.fn(),
}));

import { GET } from "@/app/api/admin/postdraft/[id]/feed/route";
import { getPostDraftById } from "@/lib/postdraft/store";
import { fetchImageBuffer, composeFeedSlide } from "@/lib/postdraft/images";
import { ADMIN_SESSION_COOKIE, createSessionToken } from "@/lib/adminSession";

function authHeader() {
  return { cookie: `${ADMIN_SESSION_COOKIE}=${createSessionToken()}` };
}

describe("GET /api/admin/postdraft/[id]/feed", () => {
  beforeEach(() => {
    process.env.ADMIN_PASSWORD = "test-password";
  });
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.ADMIN_PASSWORD;
  });

  it("returns 404 when the post draft does not exist", async () => {
    vi.mocked(getPostDraftById).mockResolvedValue(null);

    const response = await GET(
      new NextRequest("http://localhost/api/admin/postdraft/cd1/feed", { headers: authHeader() }),
      { params: Promise.resolve({ id: "cd1" }) }
    );

    expect(response.status).toBe(404);
  });

  it("composes and returns the feed slide JPEG", async () => {
    vi.mocked(getPostDraftById).mockResolvedValue({ id: "cd1", image: "https://img.example/1.webp" } as never);
    vi.mocked(fetchImageBuffer).mockResolvedValue(Buffer.from("product-image"));
    vi.mocked(composeFeedSlide).mockResolvedValue(Buffer.from("jpeg-bytes"));

    const response = await GET(
      new NextRequest("http://localhost/api/admin/postdraft/cd1/feed", { headers: authHeader() }),
      { params: Promise.resolve({ id: "cd1" }) }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(composeFeedSlide).toHaveBeenCalledWith(Buffer.from("product-image"), Buffer.from("selo"));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/api/admin/postdraft/id-story.test.ts tests/api/admin/postdraft/id-feed.test.ts`
Expected: FAIL with "Cannot find module" for both route files.

- [ ] **Step 3: Write the implementation**

```typescript
// src/app/api/admin/postdraft/[id]/story/route.ts
import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedAdminRequest } from "@/lib/adminSession";
import { getPostDraftById } from "@/lib/postdraft/store";
import { composeStory, fetchImageBuffer, loadMolduraDiagonalStory } from "@/lib/postdraft/images";

export const runtime = "nodejs";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isAuthorizedAdminRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const postDraft = await getPostDraftById(id);
  if (!postDraft) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const productImage = await fetchImageBuffer(postDraft.image);
  const jpeg = await composeStory(productImage, loadMolduraDiagonalStory(), postDraft.price);

  return new NextResponse(new Uint8Array(jpeg), {
    headers: {
      "content-type": "image/jpeg",
      "content-disposition": `inline; filename="story-${postDraft.id}.jpg"`,
    },
  });
}
```

```typescript
// src/app/api/admin/postdraft/[id]/feed/route.ts
import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedAdminRequest } from "@/lib/adminSession";
import { getPostDraftById } from "@/lib/postdraft/store";
import { composeFeedSlide, fetchImageBuffer, loadSelo } from "@/lib/postdraft/images";

export const runtime = "nodejs";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isAuthorizedAdminRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const postDraft = await getPostDraftById(id);
  if (!postDraft) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const productImage = await fetchImageBuffer(postDraft.image);
  const jpeg = await composeFeedSlide(productImage, loadSelo());

  return new NextResponse(new Uint8Array(jpeg), {
    headers: {
      "content-type": "image/jpeg",
      "content-disposition": `inline; filename="feed-${postDraft.id}.jpg"`,
    },
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/api/admin/postdraft/id-story.test.ts tests/api/admin/postdraft/id-feed.test.ts`
Expected: PASS, 3 tests each.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/admin/postdraft/[id] tests/api/admin/postdraft/id-story.test.ts tests/api/admin/postdraft/id-feed.test.ts
git commit -m "feat: add on-demand story and feed slide image routes"
```

---

### Task 9: Daily cleanup cron route + GitHub Actions workflow

**Files:**
- Create: `src/app/api/cron/postdraft-cleanup/route.ts`
- Test: `tests/api/cron/postdraft-cleanup.test.ts`
- Create: `.github/workflows/postdraft-cleanup.yml`

**Interfaces:**
- Consumes: `deleteStalePostDrafts` from `@/lib/postdraft/store` (Task 4).
- Produces: `POST /api/cron/postdraft-cleanup` (secret-protected, outside the `/admin` and `/api/admin` proxy matcher, so `proxy.ts` needs no changes) → `{ deleted: number }`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/api/cron/postdraft-cleanup.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/postdraft/store", () => ({
  deleteStalePostDrafts: vi.fn(),
}));

import { POST } from "@/app/api/cron/postdraft-cleanup/route";
import { deleteStalePostDrafts } from "@/lib/postdraft/store";

describe("POST /api/cron/postdraft-cleanup", () => {
  beforeEach(() => {
    process.env.POSTDRAFT_CLEANUP_SECRET = "test-secret";
  });
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.POSTDRAFT_CLEANUP_SECRET;
  });

  it("returns 401 without deleting when the bearer secret is missing or wrong", async () => {
    const response = await POST(
      new Request("http://localhost/api/cron/postdraft-cleanup", {
        method: "POST",
        headers: { authorization: "Bearer wrong-secret" },
      })
    );

    expect(response.status).toBe(401);
    expect(deleteStalePostDrafts).not.toHaveBeenCalled();
  });

  it("deletes stale rows and returns the count when the secret matches", async () => {
    vi.mocked(deleteStalePostDrafts).mockResolvedValue(3);

    const response = await POST(
      new Request("http://localhost/api/cron/postdraft-cleanup", {
        method: "POST",
        headers: { authorization: "Bearer test-secret" },
      })
    );
    const body = await response.json();

    expect(body).toEqual({ deleted: 3 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api/cron/postdraft-cleanup.test.ts`
Expected: FAIL with "Cannot find module '@/app/api/cron/postdraft-cleanup/route'".

- [ ] **Step 3: Write the route implementation**

```typescript
// src/app/api/cron/postdraft-cleanup/route.ts
import { NextResponse } from "next/server";
import { deleteStalePostDrafts } from "@/lib/postdraft/store";

export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.POSTDRAFT_CLEANUP_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const deleted = await deleteStalePostDrafts();
  return NextResponse.json({ deleted });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/api/cron/postdraft-cleanup.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Write the GitHub Actions workflow**

```yaml
# .github/workflows/postdraft-cleanup.yml
name: PostDraft cleanup

on:
  schedule:
    - cron: "0 3 * * *" # 00:00 America/Sao_Paulo (fixed UTC-3, no DST)
  workflow_dispatch: {}

jobs:
  cleanup:
    runs-on: ubuntu-latest
    steps:
      - name: Call the cleanup endpoint
        run: |
          curl -sf -X POST "${{ secrets.APP_URL }}/api/cron/postdraft-cleanup" \
            -H "Authorization: Bearer ${{ secrets.POSTDRAFT_CLEANUP_SECRET }}"
```

This step requires manual, out-of-repo configuration that no test can cover: set the `APP_URL` (e.g. `https://bons-achados.vercel.app`) and `POSTDRAFT_CLEANUP_SECRET` (any long random string) as GitHub repository secrets, and set the same `POSTDRAFT_CLEANUP_SECRET` value as a Vercel environment variable. Note this explicitly in the PR description so it isn't missed.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/cron/postdraft-cleanup/route.ts tests/api/cron/postdraft-cleanup.test.ts .github/workflows/postdraft-cleanup.yml
git commit -m "feat: add nightly cron to purge stale post drafts"
```

---

### Task 10: `parseDiscountPercentage()` — extract a number from the ML hub's discount label

**Files:**
- Create: `src/lib/mercadolivre/discountLabel.ts`
- Test: `tests/mercadolivre/discountLabel.test.ts`

**Interfaces:**
- Produces: `parseDiscountPercentage(label: string | null): number | null`. Consumed by Task 13 (`MercadoLivreAdmin.tsx`'s "Selecionar para postar" handler).

- [ ] **Step 1: Write the failing test**

```typescript
// tests/mercadolivre/discountLabel.test.ts
import { describe, it, expect } from "vitest";
import { parseDiscountPercentage } from "@/lib/mercadolivre/discountLabel";

describe("parseDiscountPercentage", () => {
  it("extracts the number from a typical label", () => {
    expect(parseDiscountPercentage("-50%")).toBe(50);
  });

  it("extracts the number regardless of surrounding text", () => {
    expect(parseDiscountPercentage("25% OFF")).toBe(25);
  });

  it("returns null for a null label", () => {
    expect(parseDiscountPercentage(null)).toBeNull();
  });

  it("returns null when there is no digit in the label", () => {
    expect(parseDiscountPercentage("OFERTA")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/mercadolivre/discountLabel.test.ts`
Expected: FAIL with "Cannot find module '@/lib/mercadolivre/discountLabel'".

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/mercadolivre/discountLabel.ts
export function parseDiscountPercentage(label: string | null): number | null {
  if (!label) {
    return null;
  }
  const match = label.match(/(\d+)/);
  return match ? Number(match[1]) : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/mercadolivre/discountLabel.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/mercadolivre/discountLabel.ts tests/mercadolivre/discountLabel.test.ts
git commit -m "feat: add discount label parsing for the Mercado Livre hub"
```

---

### Task 11: Manual product registration screen — `/admin/produtos/novo`

**Files:**
- Create: `src/app/admin/produtos/novo/page.tsx`
- Create: `src/app/admin/produtos/novo/NovoProdutoForm.tsx`
- Modify: `src/app/admin/AdminNav.tsx`

**Interfaces:**
- Consumes: `POST /api/admin/postdraft` (Task 6).
- Produces: nothing consumed by later tasks (leaf screen).

- [ ] **Step 1: Write the page and form**

```typescript
// src/app/admin/produtos/novo/page.tsx
import type { Metadata } from "next";
import NovoProdutoForm from "./NovoProdutoForm";

export const metadata: Metadata = {
  title: "Cadastrar produto · Bons Achados",
  description: "Cadastro manual de produtos Amazon/Shopee para o gerador de posts.",
};

export default function NovoProdutoPage() {
  return (
    <div>
      <p className="font-mono text-[11px] tracking-[0.22em] text-ash uppercase">
        Cadastro manual
      </p>
      <h1 className="font-display font-stretch-condensed text-3xl leading-none font-black text-paper uppercase italic sm:text-4xl">
        Novo <span className="text-gold">produto</span>
      </h1>
      <p className="mt-3 max-w-2xl text-sm text-ash">
        Amazon e Shopee ainda não têm coleta automática — cadastre aqui os produtos que
        você já curou manualmente. Eles entram na fila de{" "}
        <a href="/admin/postar" className="text-gold underline decoration-gold/40 underline-offset-4">
          produtos para postar
        </a>
        .
      </p>
      <div className="mt-8">
        <NovoProdutoForm />
      </div>
    </div>
  );
}
```

```typescript
// src/app/admin/produtos/novo/NovoProdutoForm.tsx
"use client";

import { useState } from "react";

type Marketplace = "AMAZON" | "SHOPEE";

type Row = {
  key: number;
  marketplace: Marketplace;
  title: string;
  affiliateLink: string;
  image: string;
  price: string;
  discount: string;
  category: string;
};

type RowStatus = { kind: "idle" } | { kind: "saving" } | { kind: "saved"; category: string } | { kind: "duplicate" } | { kind: "error"; message: string };

let nextRowKey = 0;
function emptyRow(): Row {
  nextRowKey += 1;
  return {
    key: nextRowKey,
    marketplace: "AMAZON",
    title: "",
    affiliateLink: "",
    image: "",
    price: "",
    discount: "",
    category: "",
  };
}

export default function NovoProdutoForm() {
  const [rows, setRows] = useState<Row[]>([emptyRow()]);
  const [statuses, setStatuses] = useState<Record<number, RowStatus>>({});

  function updateRow(key: number, patch: Partial<Row>) {
    setRows((previous) => previous.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function addRow() {
    setRows((previous) => [...previous, emptyRow()]);
  }

  function removeRow(key: number) {
    setRows((previous) => previous.filter((row) => row.key !== key));
    setStatuses((previous) => {
      const next = { ...previous };
      delete next[key];
      return next;
    });
  }

  async function submitRow(row: Row) {
    const price = Number(row.price.replace(",", "."));
    if (!row.title || !row.affiliateLink || !row.image || Number.isNaN(price)) {
      setStatuses((previous) => ({ ...previous, [row.key]: { kind: "error", message: "Preencha nome, link, imagem e preço." } }));
      return;
    }

    setStatuses((previous) => ({ ...previous, [row.key]: { kind: "saving" } }));
    try {
      const response = await fetch("/api/admin/postdraft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          marketplace: row.marketplace,
          source: "MANUAL",
          title: row.title,
          affiliateLink: row.affiliateLink,
          image: row.image,
          price,
          discount: row.discount ? Number(row.discount) : null,
          category: row.category || null,
        }),
      });

      if (response.status === 409) {
        setStatuses((previous) => ({ ...previous, [row.key]: { kind: "duplicate" } }));
        return;
      }
      if (!response.ok) {
        setStatuses((previous) => ({ ...previous, [row.key]: { kind: "error", message: "Não deu para cadastrar. Tente de novo." } }));
        return;
      }
      const body = await response.json();
      setStatuses((previous) => ({ ...previous, [row.key]: { kind: "saved", category: body.category } }));
    } catch {
      setStatuses((previous) => ({ ...previous, [row.key]: { kind: "error", message: "Não deu para cadastrar. Tente de novo." } }));
    }
  }

  return (
    <div className="space-y-6">
      {rows.map((row) => {
        const status = statuses[row.key] ?? { kind: "idle" as const };
        return (
          <div key={row.key} className="rounded-2xl border border-ink-line bg-ink-raised p-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="font-mono text-[11px] tracking-[0.18em] text-ash uppercase">Marketplace</span>
                <select
                  value={row.marketplace}
                  onChange={(event) => updateRow(row.key, { marketplace: event.target.value as Marketplace })}
                  className="mt-2 w-full rounded-full border border-ink-line bg-ink px-4 py-2.5 text-sm text-paper focus-visible:border-gold focus-visible:ring-2 focus-visible:ring-gold/40 focus-visible:outline-none"
                >
                  <option value="AMAZON">Amazon</option>
                  <option value="SHOPEE">Shopee</option>
                </select>
              </label>

              <label className="block">
                <span className="font-mono text-[11px] tracking-[0.18em] text-ash uppercase">Nome do produto</span>
                <input
                  value={row.title}
                  onChange={(event) => updateRow(row.key, { title: event.target.value })}
                  className="mt-2 w-full rounded-full border border-ink-line bg-ink px-4 py-2.5 text-sm text-paper placeholder:text-ash/60 focus-visible:border-gold focus-visible:ring-2 focus-visible:ring-gold/40 focus-visible:outline-none"
                />
              </label>

              <label className="block sm:col-span-2">
                <span className="font-mono text-[11px] tracking-[0.18em] text-ash uppercase">Link de afiliado</span>
                <input
                  value={row.affiliateLink}
                  onChange={(event) => updateRow(row.key, { affiliateLink: event.target.value })}
                  placeholder="https://..."
                  className="mt-2 w-full rounded-full border border-ink-line bg-ink px-4 py-2.5 text-sm text-paper placeholder:text-ash/60 focus-visible:border-gold focus-visible:ring-2 focus-visible:ring-gold/40 focus-visible:outline-none"
                />
              </label>

              <label className="block sm:col-span-2">
                <span className="font-mono text-[11px] tracking-[0.18em] text-ash uppercase">Link da imagem</span>
                <input
                  value={row.image}
                  onChange={(event) => updateRow(row.key, { image: event.target.value })}
                  placeholder="https://..."
                  className="mt-2 w-full rounded-full border border-ink-line bg-ink px-4 py-2.5 text-sm text-paper placeholder:text-ash/60 focus-visible:border-gold focus-visible:ring-2 focus-visible:ring-gold/40 focus-visible:outline-none"
                />
              </label>

              <label className="block">
                <span className="font-mono text-[11px] tracking-[0.18em] text-ash uppercase">Preço (R$)</span>
                <input
                  value={row.price}
                  onChange={(event) => updateRow(row.key, { price: event.target.value })}
                  inputMode="decimal"
                  placeholder="59,90"
                  className="mt-2 w-full rounded-full border border-ink-line bg-ink px-4 py-2.5 text-sm text-paper placeholder:text-ash/60 focus-visible:border-gold focus-visible:ring-2 focus-visible:ring-gold/40 focus-visible:outline-none"
                />
              </label>

              <label className="block">
                <span className="font-mono text-[11px] tracking-[0.18em] text-ash uppercase">Desconto % (opcional)</span>
                <input
                  value={row.discount}
                  onChange={(event) => updateRow(row.key, { discount: event.target.value })}
                  inputMode="numeric"
                  placeholder="25"
                  className="mt-2 w-full rounded-full border border-ink-line bg-ink px-4 py-2.5 text-sm text-paper placeholder:text-ash/60 focus-visible:border-gold focus-visible:ring-2 focus-visible:ring-gold/40 focus-visible:outline-none"
                />
              </label>

              <label className="block sm:col-span-2">
                <span className="font-mono text-[11px] tracking-[0.18em] text-ash uppercase">Categoria (opcional)</span>
                <input
                  value={row.category}
                  onChange={(event) => updateRow(row.key, { category: event.target.value })}
                  placeholder="deixe em branco pra sugerir automaticamente"
                  className="mt-2 w-full rounded-full border border-ink-line bg-ink px-4 py-2.5 text-sm text-paper placeholder:text-ash/60 focus-visible:border-gold focus-visible:ring-2 focus-visible:ring-gold/40 focus-visible:outline-none"
                />
              </label>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => submitRow(row)}
                disabled={status.kind === "saving" || status.kind === "saved"}
                className="rounded-full bg-gold px-6 py-2.5 font-display font-stretch-condensed text-sm font-black tracking-wide text-ink uppercase italic transition hover:bg-paper focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-ink-raised focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
              >
                {status.kind === "saving"
                  ? "Cadastrando…"
                  : status.kind === "saved"
                    ? "Cadastrado ✓"
                    : "Cadastrar"}
              </button>
              {rows.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeRow(row.key)}
                  className="font-mono text-xs tracking-wider text-ash uppercase transition hover:text-paper focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
                >
                  Remover
                </button>
              )}
              {status.kind === "saved" && (
                <span className="font-mono text-xs text-ash">categoria: {status.category}</span>
              )}
              {status.kind === "duplicate" && (
                <span role="alert" className="text-sm text-alert">
                  Esse link já foi cadastrado hoje.
                </span>
              )}
              {status.kind === "error" && (
                <span role="alert" className="text-sm text-alert">
                  {status.message}
                </span>
              )}
            </div>
          </div>
        );
      })}

      <button
        type="button"
        onClick={addRow}
        className="rounded-full border border-ink-line bg-ink-raised px-6 py-2.5 font-display font-stretch-condensed text-sm font-black tracking-wide text-paper uppercase italic transition hover:border-gold hover:text-gold focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-ink focus-visible:outline-none"
      >
        Adicionar outro produto
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Add the nav link**

In `src/app/admin/AdminNav.tsx`, add an entry to the `LINKS` array (keep the existing two entries, insert this one before "Hub Mercado Livre" so it reads dashboard → cadastro → hub):

```typescript
const LINKS = [
  { href: "/admin", label: "Painel" },
  { href: "/admin/produtos/novo", label: "Cadastrar produto" },
  { href: "/admin/mercadolivre", label: "Hub Mercado Livre" },
];
```

- [ ] **Step 3: Verify with build, lint, and a visual check**

Run: `npm run lint && npm run build`
Expected: both succeed with no errors.

Then start the dev server (`npm run dev`), log in, open `/admin/produtos/novo`, fill one row with a fake Amazon product, submit, and confirm the button shows "Cadastrado ✓" with the auto-suggested category next to it. Submit the exact same `affiliateLink` again in a new row and confirm it shows "Esse link já foi cadastrado hoje."

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/produtos/novo src/app/admin/AdminNav.tsx
git commit -m "feat: add manual product registration screen"
```

---

### Task 12: Posting queue screen — `/admin/postar`

**Files:**
- Create: `src/app/admin/postar/page.tsx`
- Create: `src/app/admin/postar/PostarQueue.tsx`
- Modify: `src/app/admin/AdminNav.tsx`
- Modify: `src/app/admin/page.tsx` (dashboard CTA)

**Interfaces:**
- Consumes: `GET /api/admin/postdraft`, `POST /api/admin/postdraft/clear`, `GET /api/admin/postdraft/[id]/story`, `GET /api/admin/postdraft/[id]/feed` (Tasks 6, 7, 8).
- Produces: nothing consumed by later tasks (leaf screen).

- [ ] **Step 1: Write the page and queue component**

```typescript
// src/app/admin/postar/page.tsx
import type { Metadata } from "next";
import PostarQueue from "./PostarQueue";

export const metadata: Metadata = {
  title: "Produtos para postar · Bons Achados",
  description: "Fila de produtos selecionados, com imagens e legenda prontas pra postar.",
};

export default function PostarPage() {
  return (
    <div>
      <p className="font-mono text-[11px] tracking-[0.22em] text-ash uppercase">
        Gerador de posts
      </p>
      <h1 className="font-display font-stretch-condensed text-3xl leading-none font-black text-paper uppercase italic sm:text-4xl">
        Produtos para <span className="text-gold">postar</span>
      </h1>
      <div className="mt-8">
        <PostarQueue />
      </div>
    </div>
  );
}
```

```typescript
// src/app/admin/postar/PostarQueue.tsx
"use client";

import { useCallback, useEffect, useState } from "react";

type PostDraftItem = {
  id: string;
  title: string;
  affiliateLink: string;
  price: number;
  discount: number | null;
  marketplace: string;
};

function formatPrice(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function PostarQueue() {
  const [items, setItems] = useState<PostDraftItem[]>([]);
  const [caption, setCaption] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/postdraft");
      if (!response.ok) {
        throw new Error("load_failed");
      }
      const body = await response.json();
      setItems(body.items);
      setCaption(body.caption);
    } catch {
      setError("Não deu para carregar a fila. Tente de novo em alguns segundos.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleClear() {
    setClearing(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/postdraft/clear", { method: "POST" });
      if (!response.ok) {
        throw new Error("clear_failed");
      }
      await load();
    } catch {
      setError("Não deu para limpar a lista. Tente de novo.");
    } finally {
      setClearing(false);
    }
  }

  async function handleCopyCaption() {
    try {
      await navigator.clipboard.writeText(caption);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("O navegador bloqueou a cópia. Selecione o texto e copie na mão.");
    }
  }

  if (loading) {
    return <p className="text-sm text-ash">Carregando a fila…</p>;
  }

  return (
    <div>
      {error && (
        <p role="alert" className="mb-6 rounded-xl border border-alert/40 bg-alert/10 px-4 py-3 text-sm text-paper">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="font-mono text-[11px] tracking-[0.2em] text-ash uppercase">
          {items.length} produto{items.length === 1 ? "" : "s"} na fila
        </p>
        <button
          type="button"
          onClick={handleClear}
          disabled={clearing || items.length === 0}
          className="rounded-full border border-ink-line bg-ink-raised px-6 py-2.5 font-display font-stretch-condensed text-sm font-black tracking-wide text-paper uppercase italic transition hover:border-alert hover:text-alert focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
        >
          {clearing ? "Limpando…" : "Limpar lista"}
        </button>
      </div>

      {items.length === 0 && (
        <p className="mt-10 max-w-md text-sm text-ash">
          Nada na fila agora. Cadastre um produto manual ou selecione itens no hub do
          Mercado Livre pra começar.
        </p>
      )}

      <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <div key={item.id} className="overflow-hidden rounded-2xl border border-ink-line bg-ink-raised p-4">
            <h2 className="line-clamp-2 text-sm leading-snug text-paper">{item.title}</h2>
            <p className="mt-1 font-mono text-xs text-gold tabular-nums">
              {formatPrice(item.price)}
              {item.discount ? ` · ${item.discount}% OFF` : ""}
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/admin/postdraft/${item.id}/story`}
                alt=""
                loading="lazy"
                className="aspect-[9/16] w-full rounded-lg object-cover"
              />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/admin/postdraft/${item.id}/feed`}
                alt=""
                loading="lazy"
                className="aspect-[4/5] w-full rounded-lg object-cover"
              />
            </div>
            <div className="mt-3 flex gap-2">
              <a
                href={`/api/admin/postdraft/${item.id}/story`}
                download={`story-${item.id}.jpg`}
                className="flex-1 rounded-full bg-ink px-3 py-2 text-center font-mono text-[10px] tracking-wider text-gold uppercase transition hover:bg-ink-raised"
              >
                Baixar story
              </a>
              <a
                href={`/api/admin/postdraft/${item.id}/feed`}
                download={`feed-${item.id}.jpg`}
                className="flex-1 rounded-full bg-ink px-3 py-2 text-center font-mono text-[10px] tracking-wider text-gold uppercase transition hover:bg-ink-raised"
              >
                Baixar feed
              </a>
            </div>
          </div>
        ))}
      </div>

      {items.length > 0 && (
        <div className="mt-8 rounded-2xl border border-ink-line bg-ink-raised p-6">
          <div className="flex items-center justify-between gap-4">
            <h2 className="font-display font-stretch-condensed text-lg font-black tracking-tight text-paper uppercase italic">
              Legenda do carrossel
            </h2>
            <button
              type="button"
              onClick={handleCopyCaption}
              className="rounded-full bg-gold px-4 py-1.5 font-mono text-[10px] tracking-wider text-ink uppercase transition hover:bg-paper"
            >
              {copied ? "Copiado" : "Copiar"}
            </button>
          </div>
          <textarea
            readOnly
            value={caption}
            rows={10}
            className="mt-4 w-full resize-y rounded-xl border border-ink-line bg-ink p-3 font-mono text-xs text-paper focus-visible:border-gold focus-visible:ring-2 focus-visible:ring-gold/40 focus-visible:outline-none"
          />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add the nav link**

In `src/app/admin/AdminNav.tsx`, extend `LINKS` again (final order: Painel → Cadastrar produto → Hub Mercado Livre → Postar):

```typescript
const LINKS = [
  { href: "/admin", label: "Painel" },
  { href: "/admin/produtos/novo", label: "Cadastrar produto" },
  { href: "/admin/mercadolivre", label: "Hub Mercado Livre" },
  { href: "/admin/postar", label: "Postar" },
];
```

- [ ] **Step 3: Link to it from the dashboard**

In `src/app/admin/page.tsx`, find the existing CTA block at the bottom (the `<Link href="/admin/mercadolivre">` button) and add a second link next to it:

```typescript
      <div className="mt-8 flex flex-wrap justify-center gap-3 sm:justify-start">
        <Link
          href="/admin/mercadolivre"
          className="rounded-full bg-gold px-7 py-2.5 font-display font-stretch-condensed text-sm font-black tracking-wide text-ink uppercase italic transition hover:bg-paper focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-ink focus-visible:outline-none"
        >
          Ir para o Hub Mercado Livre →
        </Link>
        <Link
          href="/admin/postar"
          className="rounded-full border border-ink-line bg-ink-raised px-7 py-2.5 font-display font-stretch-condensed text-sm font-black tracking-wide text-paper uppercase italic transition hover:border-gold hover:text-gold focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-ink focus-visible:outline-none"
        >
          Produtos para postar →
        </Link>
      </div>
```

Replace the single-button block that currently ends the file with this two-button block (keep everything above it in `admin/page.tsx` unchanged).

- [ ] **Step 4: Verify with build, lint, and a visual check**

Run: `npm run lint && npm run build`
Expected: both succeed with no errors.

Then start the dev server, log in, cadastre pelo menos um produto manual em `/admin/produtos/novo` (Task 11), abra `/admin/postar` e confirme: as duas imagens carregam e batem visualmente com o kit de marca (moldura + pill de preço no story, selo no canto inferior direito do feed), o link de download funciona, a legenda aparece e o botão "Copiar" funciona, e "Limpar lista" esvazia a tela. A seleção a partir do hub do Mercado Livre (Task 13) ainda não existe neste ponto — ela é verificada end-to-end na Task 14.

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/postar src/app/admin/AdminNav.tsx src/app/admin/page.tsx
git commit -m "feat: add posting queue screen with generated images and caption"
```

---

### Task 13: "Selecionar para postar" button on the Mercado Livre hub

**Files:**
- Modify: `src/app/admin/mercadolivre/MercadoLivreAdmin.tsx`

**Interfaces:**
- Consumes: `parseDiscountPercentage` from `@/lib/mercadolivre/discountLabel` (Task 10), `POST /api/admin/postdraft` (Task 6).

- [ ] **Step 1: Add state and the handler**

In `src/app/admin/mercadolivre/MercadoLivreAdmin.tsx`, add the import near the top (alongside the other imports):

```typescript
import { parseDiscountPercentage } from "@/lib/mercadolivre/discountLabel";
```

Add new state next to the existing `generatedLinks`/`copiedItemId` state (inside the `MercadoLivreAdmin` component body):

```typescript
  const [selectingItemId, setSelectingItemId] = useState<string | null>(null);
  const [selectedForPost, setSelectedForPost] = useState<Record<string, boolean>>({});
```

Add the handler function next to `handleGenerateLink`/`handleCopy`:

```typescript
  async function handleSelectForPost(item: MLHubItem, affiliateLink: string) {
    setSelectingItemId(item.itemId);
    setSearchError(null);
    try {
      const response = await fetch("/api/admin/postdraft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          marketplace: "MERCADO_LIVRE",
          source: "AUTO",
          title: item.title,
          affiliateLink,
          image: item.image,
          price: item.price,
          discount: parseDiscountPercentage(item.discountLabel),
          category: null,
        }),
      });
      if (response.status === 401) {
        expireSession();
        return;
      }
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
```

- [ ] **Step 2: Render the button**

Find the block that renders the generated-link copy box (starts with `{generatedLink ? (`). Add the "Selecionar para postar" button right after that `{generatedLink ? ( ... ) : ( ... )}` block, still inside the same `<div className="mt-auto pt-1">`:

```typescript
                        {generatedLink && (
                          <button
                            type="button"
                            onClick={() => handleSelectForPost(item, generatedLink)}
                            disabled={selectingItemId === item.itemId || selectedForPost[item.itemId]}
                            className="mt-2 w-full rounded-full border border-gold/40 px-4 py-2 font-mono text-[10px] tracking-wider text-gold uppercase transition hover:bg-gold hover:text-ink focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {selectedForPost[item.itemId]
                              ? "Selecionado ✓"
                              : selectingItemId === item.itemId
                                ? "Selecionando…"
                                : "Selecionar para postar"}
                          </button>
                        )}
```

- [ ] **Step 3: Verify with build, lint, and a visual check**

Run: `npm run lint && npm run build`
Expected: both succeed with no errors.

Then start the dev server, log in, search the hub, generate a link for one item, click "Selecionar para postar", and confirm it flips to "Selecionado ✓". Open `/admin/postar` (Task 12) and confirm that item shows up with generated images.

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/mercadolivre/MercadoLivreAdmin.tsx
git commit -m "feat: add select-for-posting action to the Mercado Livre hub cards"
```

---

### Task 14: Full verification pass

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite**

Run: `npm run test`
Expected: every test file passes, including all tests added in Tasks 1–13.

- [ ] **Step 2: Lint and build**

Run: `npm run lint && npm run build`
Expected: both succeed with no errors or warnings about the new routes/pages.

- [ ] **Step 3: End-to-end manual walkthrough**

With the dev server running and logged in:
1. `/admin/produtos/novo` — cadastre um produto Amazon; confirme categoria sugerida e o aviso de duplicidade ao reenviar o mesmo link.
2. `/admin/mercadolivre` — busque um termo, gere um link, clique "Selecionar para postar".
3. `/admin/postar` — confirme os dois produtos na fila, com imagens (moldura+pill no story, selo no feed) carregando corretamente, downloads funcionando, e a legenda cobrindo os dois itens com as hashtags certas.
4. Clique "Limpar lista" e confirme que a fila esvazia.
5. Tente cadastrar de novo o mesmo produto Amazon do passo 1 (mesmo link) — confirme que ainda é bloqueado como duplicado, mesmo com a fila limpa (prova que o dedup sobrevive ao "Limpar lista").

- [ ] **Step 4: Final commit if anything was adjusted during the walkthrough**

```bash
git add -A
git commit -m "chore: fix issues found during post generator end-to-end walkthrough"
```

(Skip this commit if the walkthrough found nothing to fix.)
