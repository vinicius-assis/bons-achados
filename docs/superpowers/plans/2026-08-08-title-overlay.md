# Título no topo da imagem gerada — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user edit a product's title in a modal at "Selecionar para postar" time, and render that title as an overlay at the top of the generated story and feed images.

**Architecture:** A new nullable `PostDraft.imageTitle` column stores the edited text, decoupled from `PostDraft.title` (unchanged, still used everywhere else). A shared `PostTitleModal` client component, mounted in all three marketplace admin pages, collects the text before the existing `POST /api/admin/postdraft` call. `src/lib/postdraft/images.ts` gains a canvas-based text-wrapping/auto-shrink layer drawn last (on top of everything else) in both `composeStory` and `composeFeedSlide`. The two image routes pass `postDraft.imageTitle ?? postDraft.title` through, so old rows (created before this feature) keep working.

**Tech Stack:** Next.js (App Router) API routes, Prisma (PostgreSQL), `sharp` + `@napi-rs/canvas` for image composition, Vitest for tests, React client components (no test infra for components exists in this repo — verify UI manually).

## Global Constraints

- `PostDraft.imageTitle` must be **nullable** — no destructive migration on existing rows (spec: "evita migração destrutiva").
- Registros antigos com `imageTitle` null usam `title` como fallback no overlay.
- O título editado nunca sobrescreve `PostDraft.title`.
- O overlay é texto puro (sem faixa de fundo), com contorno escuro para legibilidade, no topo da imagem, quebrando em até 3 linhas com auto-redução de fonte.
- `imageTitle` fica fixo após a seleção — sem edição posterior na tela Postar.
- Segue o padrão de código existente: código em inglês, comentários só quando o "porquê" não é óbvio, sem abstrações além do necessário.

---

### Task 1: `PostDraft.imageTitle` schema field + migration

**Files:**
- Modify: `prisma/schema.prisma` (model `PostDraft`, around line 39)
- Create: `prisma/migrations/<timestamp>_add_post_draft_image_title/migration.sql`

**Interfaces:**
- Produces: `PostDraft.imageTitle: string | null` on the Prisma model, consumed by Task 2 (`store.ts`), Task 3 (route validation), and Task 5 (image routes).

- [ ] **Step 1: Add the field to the schema**

In `prisma/schema.prisma`, inside `model PostDraft { ... }`, add `imageTitle` right after `title`:

```prisma
model PostDraft {
  id            String        @id @default(cuid())
  marketplace   Marketplace
  source        ProductSource
  title         String
  imageTitle    String?
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

Run: `npx prisma migrate dev --name add_post_draft_image_title`

Expected: creates `prisma/migrations/<timestamp>_add_post_draft_image_title/migration.sql` containing:

```sql
-- AlterTable
ALTER TABLE "PostDraft" ADD COLUMN     "imageTitle" TEXT;
```

and applies it to the dev database. If this environment can't reach `DATABASE_URL`, create the migration folder and `migration.sql` file manually with the SQL above (matching the exact folder-naming pattern of the existing migrations under `prisma/migrations/`), then run `npx prisma generate` so `@prisma/client` picks up the new field in its types. Apply the migration for real once DB access is available.

- [ ] **Step 3: Verify the generated Prisma client has the field**

Run: `npx prisma generate`
Expected: no errors; `node_modules/@prisma/client` types now include `imageTitle` on `PostDraft`.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat: add nullable imageTitle column to PostDraft"
```

---

### Task 2: `createPostDraft` accepts `imageTitle`

**Files:**
- Modify: `src/lib/postdraft/store.ts`
- Test: `tests/lib/postdraft/store.test.ts`

**Interfaces:**
- Consumes: `PostDraft.imageTitle` field from Task 1.
- Produces: `CreatePostDraftInput.imageTitle: string`, required — consumed by Task 3 (`POST /api/admin/postdraft` route).

- [ ] **Step 1: Update the failing test's base input and assertion**

In `tests/lib/postdraft/store.test.ts`, add `imageTitle` to `BASE_INPUT` (around line 25):

```ts
const BASE_INPUT = {
  marketplace: "MERCADO_LIVRE" as const,
  source: "AUTO" as const,
  title: "Creatina 1kg Suplemento",
  imageTitle: "Creatina 1kg Suplemento",
  affiliateLink: "https://meli.la/abc",
  image: "https://img.example/1.webp",
  price: 59.9,
  discount: 25,
  category: null,
};
```

Then update the first test's assertion (around line 54) to expect `imageTitle` in the created data:

```ts
  it("creates a row and auto-categorizes when category is not supplied", async () => {
    vi.mocked(prisma.postDraft.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.postDraft.create).mockResolvedValue({ id: "cd1" } as never);

    const result = await createPostDraft(BASE_INPUT);

    expect(result).toEqual({ status: "created", id: "cd1", category: "suplemento" });
    expect(prisma.postDraft.create).toHaveBeenCalledWith({
      data: { ...BASE_INPUT, category: "suplemento" },
    });
  });
```

(This test already spreads `BASE_INPUT`, so adding `imageTitle` there is enough — no other test in this file needs to change.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/lib/postdraft/store.test.ts`
Expected: FAIL — `Property 'imageTitle' is missing` (TS) or the `create` mock assertion fails because `CreatePostDraftInput` doesn't have `imageTitle` yet.

- [ ] **Step 3: Add `imageTitle` to the store**

In `src/lib/postdraft/store.ts`, update `CreatePostDraftInput`:

```ts
export type CreatePostDraftInput = {
  marketplace: Marketplace;
  source: ProductSource;
  title: string;
  imageTitle: string;
  affiliateLink: string;
  image: string;
  price: number;
  discount: number | null;
  category: string | null;
};
```

`createPostDraft` already does `data: { ...input, category }` (line 35), so `imageTitle` flows through automatically — no other change needed in this file.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/lib/postdraft/store.test.ts`
Expected: PASS (all tests in the file, not just the modified one)

- [ ] **Step 5: Commit**

```bash
git add src/lib/postdraft/store.ts tests/lib/postdraft/store.test.ts
git commit -m "feat: pass imageTitle through createPostDraft"
```

---

### Task 3: `POST /api/admin/postdraft` validates and forwards `imageTitle`

**Files:**
- Modify: `src/app/api/admin/postdraft/route.ts`
- Test: `tests/api/admin/postdraft/route.test.ts`

**Interfaces:**
- Consumes: `CreatePostDraftInput.imageTitle: string` from Task 2.
- Produces: the API now requires `imageTitle` in the POST body — consumed by Task 6/7 (admin pages sending the request).

- [ ] **Step 1: Add failing tests**

In `tests/api/admin/postdraft/route.test.ts`, add `imageTitle` to `VALID_BODY` (around line 17):

```ts
const VALID_BODY = {
  marketplace: "MERCADO_LIVRE",
  source: "AUTO",
  title: "Creatina 1kg",
  imageTitle: "Creatina 1kg",
  affiliateLink: "https://meli.la/abc",
  image: "https://img.example/1.webp",
  price: 59.9,
  discount: 25,
  category: null,
};
```

Then add a new test right after "returns 400 for a missing required field" (around line 95):

```ts
  it("returns 400 for a missing imageTitle", async () => {
    const response = await POST(buildRequest({ ...VALID_BODY, imageTitle: "" }));

    expect(response.status).toBe(400);
    expect(createPostDraft).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/api/admin/postdraft/route.test.ts`
Expected: FAIL — the new "missing imageTitle" test fails because the route doesn't validate it yet (falls through to `createPostDraft`, which the mock accepts), and/or existing "creates a post draft" test now sends an extra field the route silently drops, which is harmless but the new test won't pass without validation.

- [ ] **Step 3: Validate and forward `imageTitle` in the route**

In `src/app/api/admin/postdraft/route.ts`, add parsing right after `title` (around line 36):

```ts
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const imageTitle = typeof body?.imageTitle === "string" ? body.imageTitle.trim() : "";
```

Add `!imageTitle` to the validation condition (around line 43-52):

```ts
  if (
    !VALID_MARKETPLACES.includes(marketplace) ||
    !VALID_SOURCES.includes(source) ||
    !title ||
    !imageTitle ||
    !affiliateLink ||
    !image ||
    Number.isNaN(price) ||
    !Number.isFinite(price) ||
    price <= 0
  ) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
```

Pass it into `createPostDraft` (around line 56):

```ts
  const result = await createPostDraft({
    marketplace,
    source,
    title,
    imageTitle,
    affiliateLink,
    image,
    price,
    discount,
    category,
  });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/api/admin/postdraft/route.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/api/admin/postdraft/route.ts tests/api/admin/postdraft/route.test.ts
git commit -m "feat: require and forward imageTitle in POST /api/admin/postdraft"
```

---

### Task 4: Title overlay layer in the image pipeline

**Files:**
- Modify: `src/lib/postdraft/images.ts`
- Test: `tests/lib/postdraft/images.test.ts`

**Interfaces:**
- Produces: `composeStory(productImage: Buffer, molduraImage: Buffer, price: number, title: string): Promise<Buffer>` (new 4th param), `composeFeedSlide(productImage: Buffer, seloImage: Buffer, title: string): Promise<Buffer>` (new 3rd param), and an exported `fitTitleText(title: string, canvasWidth: number): { lines: string[]; fontSize: number }` — consumed by Task 5 (image routes) and used internally by this task's own tests.

- [ ] **Step 1: Write the failing tests**

In `tests/lib/postdraft/images.test.ts`, replace the whole file with:

```ts
import { describe, it, expect } from "vitest";
import sharp from "sharp";
import {
  composeStory,
  composeFeedSlide,
  loadMolduraDiagonalStory,
  loadSelo,
  fitTitleText,
} from "@/lib/postdraft/images";

async function fakeProductImage(): Promise<Buffer> {
  return sharp({
    create: { width: 600, height: 400, channels: 3, background: { r: 200, g: 30, b: 30 } },
  })
    .png()
    .toBuffer();
}

describe("composeStory", () => {
  it("returns a 1080x1920 JPEG with the price pill and title composited on top of the moldura", async () => {
    const buffer = await composeStory(
      await fakeProductImage(),
      loadMolduraDiagonalStory(),
      59.9,
      "Creatina 1kg Suplemento em Pó"
    );
    const metadata = await sharp(buffer).metadata();

    expect(metadata.format).toBe("jpeg");
    expect(metadata.width).toBe(1080);
    expect(metadata.height).toBe(1920);
  });
});

describe("composeFeedSlide", () => {
  it("returns a 1080x1350 JPEG with the selo and title composited on top", async () => {
    const buffer = await composeFeedSlide(
      await fakeProductImage(),
      loadSelo(),
      "Creatina 1kg Suplemento em Pó"
    );
    const metadata = await sharp(buffer).metadata();

    expect(metadata.format).toBe("jpeg");
    expect(metadata.width).toBe(1080);
    expect(metadata.height).toBe(1350);
  });
});

describe("fitTitleText", () => {
  it("keeps a short title on a single line at the starting font size", () => {
    const { lines, fontSize } = fitTitleText("Fone Bluetooth", 1080);

    expect(lines).toEqual(["Fone Bluetooth"]);
    expect(fontSize).toBe(64);
  });

  it("wraps a long title into at most 3 lines", () => {
    const longTitle =
      "Fone de Ouvido Bluetooth 5.3 Sem Fio com Cancelamento de Ruído Ativo e Estojo de Carregamento Rápido USB-C";

    const { lines, fontSize } = fitTitleText(longTitle, 1080);

    expect(lines.length).toBeGreaterThan(1);
    expect(lines.length).toBeLessThanOrEqual(3);
    expect(fontSize).toBeLessThanOrEqual(64);
  });

  it("never returns more than 3 lines even for an extremely long title", () => {
    const extremeTitle = "Produto ".repeat(60).trim();

    const { lines } = fitTitleText(extremeTitle, 1080);

    expect(lines.length).toBeLessThanOrEqual(3);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/lib/postdraft/images.test.ts`
Expected: FAIL — `fitTitleText` is not exported, and `composeStory`/`composeFeedSlide` are called with an extra `title` argument they don't accept yet (TypeScript compile error / wrong-arity call).

- [ ] **Step 3: Implement the title layer**

In `src/lib/postdraft/images.ts`, add these constants near the top, after the existing `SELO_SIZE_RATIO` line:

```ts
const TITLE_SIDE_MARGIN = 80;
const TITLE_TOP_MARGIN = 90;
const TITLE_MAX_LINES = 3;
const TITLE_START_FONT = 64;
const TITLE_MIN_FONT = 36;
const TITLE_FONT_STEP = 4;
const TITLE_LINE_HEIGHT_RATIO = 1.2;
const TITLE_FILL_COLOR = "#FFFFFF";
const TITLE_STROKE_COLOR = "#0D1012";
const TITLE_STROKE_WIDTH = 6;
```

Add the import for `SKRSContext2D` at the top (extend the existing `@napi-rs/canvas` import):

```ts
import { createCanvas, GlobalFonts, type SKRSContext2D } from "@napi-rs/canvas";
```

Add the wrapping/fitting/drawing functions right after `drawPricePill` (after line 131 in the current file):

```ts
function wrapTitleLines(ctx: SKRSContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && ctx.measureText(candidate).width > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) {
    lines.push(current);
  }

  return lines;
}

export function fitTitleText(
  title: string,
  canvasWidth: number
): { lines: string[]; fontSize: number } {
  ensureFontRegistered();
  const measureCanvas = createCanvas(canvasWidth, 1);
  const ctx = measureCanvas.getContext("2d");
  const maxTextWidth = canvasWidth - TITLE_SIDE_MARGIN * 2;

  for (let fontSize = TITLE_START_FONT; fontSize >= TITLE_MIN_FONT; fontSize -= TITLE_FONT_STEP) {
    ctx.font = `${fontSize}px "${FONT_FAMILY}"`;
    const lines = wrapTitleLines(ctx, title, maxTextWidth);
    if (lines.length <= TITLE_MAX_LINES) {
      return { lines, fontSize };
    }
  }

  ctx.font = `${TITLE_MIN_FONT}px "${FONT_FAMILY}"`;
  return {
    lines: wrapTitleLines(ctx, title, maxTextWidth).slice(0, TITLE_MAX_LINES),
    fontSize: TITLE_MIN_FONT,
  };
}

function drawTitleLayer(title: string, canvasWidth: number, canvasHeight: number): Buffer {
  ensureFontRegistered();
  const canvas = createCanvas(canvasWidth, canvasHeight);
  const ctx = canvas.getContext("2d");
  const { lines, fontSize } = fitTitleText(title, canvasWidth);

  ctx.font = `${fontSize}px "${FONT_FAMILY}"`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.lineJoin = "round";
  ctx.lineWidth = TITLE_STROKE_WIDTH;
  ctx.strokeStyle = TITLE_STROKE_COLOR;
  ctx.fillStyle = TITLE_FILL_COLOR;

  const lineHeight = fontSize * TITLE_LINE_HEIGHT_RATIO;
  const centerX = canvasWidth / 2;

  lines.forEach((line, index) => {
    const y = TITLE_TOP_MARGIN + index * lineHeight;
    ctx.strokeText(line, centerX, y);
    ctx.fillText(line, centerX, y);
  });

  return canvas.toBuffer("image/png");
}

async function pasteTitle(canvasImage: Buffer, title: string): Promise<Buffer> {
  const metadata = await sharp(canvasImage).metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  const titleLayer = drawTitleLayer(title, width, height);
  return sharp(canvasImage).composite([{ input: titleLayer }]).png().toBuffer();
}
```

Update `composeStory` and `composeFeedSlide` (the two functions at the bottom of the file):

```ts
export async function composeStory(
  productImage: Buffer,
  molduraImage: Buffer,
  price: number,
  title: string
): Promise<Buffer> {
  const molduraMeta = await sharp(molduraImage).metadata();
  const size = { width: molduraMeta.width ?? 1080, height: molduraMeta.height ?? 1920 };

  let canvas = await fitOnCanvas(productImage, size);
  canvas = await pasteOverlay(canvas, molduraImage);
  canvas = await drawPricePill(canvas, price);
  canvas = await pasteTitle(canvas, title);

  return sharp(canvas).jpeg({ quality: 90 }).toBuffer();
}

export async function composeFeedSlide(
  productImage: Buffer,
  seloImage: Buffer,
  title: string
): Promise<Buffer> {
  let canvas = await fitOnCanvas(productImage, FEED_SIZE);
  canvas = await pasteSelo(canvas, seloImage);
  canvas = await pasteTitle(canvas, title);
  return sharp(canvas).jpeg({ quality: 90 }).toBuffer();
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/lib/postdraft/images.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/postdraft/images.ts tests/lib/postdraft/images.test.ts
git commit -m "feat: draw title overlay at the top of story and feed images"
```

---

### Task 5: Image routes pass `imageTitle` (with fallback) into the pipeline

**Files:**
- Modify: `src/app/api/admin/postdraft/[id]/story/route.ts`
- Modify: `src/app/api/admin/postdraft/[id]/feed/route.ts`
- Test: `tests/api/admin/postdraft/id-story.test.ts`
- Test: `tests/api/admin/postdraft/id-feed.test.ts`

**Interfaces:**
- Consumes: `composeStory(..., title: string)` and `composeFeedSlide(..., title: string)` from Task 4; `PostDraft.imageTitle` from Task 1.

- [ ] **Step 1: Update the failing story route test**

In `tests/api/admin/postdraft/id-story.test.ts`, update the "composes and returns the story JPEG" test (around line 51):

```ts
  it("composes and returns the story JPEG using imageTitle", async () => {
    vi.mocked(getPostDraftById).mockResolvedValue({
      id: "cd1",
      image: "https://img.example/1.webp",
      price: 59.9,
      title: "Creatina 1kg",
      imageTitle: "Creatina em Pó 1kg",
    } as never);
    vi.mocked(fetchImageBuffer).mockResolvedValue(Buffer.from("product-image"));
    vi.mocked(composeStory).mockResolvedValue(Buffer.from("jpeg-bytes"));

    const response = await GET(
      new NextRequest("http://localhost/api/admin/postdraft/cd1/story", { headers: authHeader() }),
      { params: Promise.resolve({ id: "cd1" }) }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(composeStory).toHaveBeenCalledWith(
      Buffer.from("product-image"),
      Buffer.from("moldura"),
      59.9,
      "Creatina em Pó 1kg"
    );
  });

  it("falls back to title when imageTitle is null", async () => {
    vi.mocked(getPostDraftById).mockResolvedValue({
      id: "cd1",
      image: "https://img.example/1.webp",
      price: 59.9,
      title: "Creatina 1kg",
      imageTitle: null,
    } as never);
    vi.mocked(fetchImageBuffer).mockResolvedValue(Buffer.from("product-image"));
    vi.mocked(composeStory).mockResolvedValue(Buffer.from("jpeg-bytes"));

    await GET(
      new NextRequest("http://localhost/api/admin/postdraft/cd1/story", { headers: authHeader() }),
      { params: Promise.resolve({ id: "cd1" }) }
    );

    expect(composeStory).toHaveBeenCalledWith(
      Buffer.from("product-image"),
      Buffer.from("moldura"),
      59.9,
      "Creatina 1kg"
    );
  });
```

- [ ] **Step 2: Update the failing feed route test**

In `tests/api/admin/postdraft/id-feed.test.ts`, update the "composes and returns the feed slide JPEG" test (around line 42):

```ts
  it("composes and returns the feed slide JPEG using imageTitle", async () => {
    vi.mocked(getPostDraftById).mockResolvedValue({
      id: "cd1",
      image: "https://img.example/1.webp",
      title: "Creatina 1kg",
      imageTitle: "Creatina em Pó 1kg",
    } as never);
    vi.mocked(fetchImageBuffer).mockResolvedValue(Buffer.from("product-image"));
    vi.mocked(composeFeedSlide).mockResolvedValue(Buffer.from("jpeg-bytes"));

    const response = await GET(
      new NextRequest("http://localhost/api/admin/postdraft/cd1/feed", { headers: authHeader() }),
      { params: Promise.resolve({ id: "cd1" }) }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(composeFeedSlide).toHaveBeenCalledWith(
      Buffer.from("product-image"),
      Buffer.from("selo"),
      "Creatina em Pó 1kg"
    );
  });

  it("falls back to title when imageTitle is null", async () => {
    vi.mocked(getPostDraftById).mockResolvedValue({
      id: "cd1",
      image: "https://img.example/1.webp",
      title: "Creatina 1kg",
      imageTitle: null,
    } as never);
    vi.mocked(fetchImageBuffer).mockResolvedValue(Buffer.from("product-image"));
    vi.mocked(composeFeedSlide).mockResolvedValue(Buffer.from("jpeg-bytes"));

    await GET(
      new NextRequest("http://localhost/api/admin/postdraft/cd1/feed", { headers: authHeader() }),
      { params: Promise.resolve({ id: "cd1" }) }
    );

    expect(composeFeedSlide).toHaveBeenCalledWith(
      Buffer.from("product-image"),
      Buffer.from("selo"),
      "Creatina 1kg"
    );
  });
```

- [ ] **Step 3: Run both test files to verify they fail**

Run: `npx vitest run tests/api/admin/postdraft/id-story.test.ts tests/api/admin/postdraft/id-feed.test.ts`
Expected: FAIL — `composeStory`/`composeFeedSlide` mocks are called without the `title` argument.

- [ ] **Step 4: Update the routes**

In `src/app/api/admin/postdraft/[id]/story/route.ts`, change line 20:

```ts
  const productImage = await fetchImageBuffer(postDraft.image);
  const jpeg = await composeStory(
    productImage,
    loadMolduraDiagonalStory(),
    postDraft.price,
    postDraft.imageTitle ?? postDraft.title
  );
```

In `src/app/api/admin/postdraft/[id]/feed/route.ts`, change line 20:

```ts
  const productImage = await fetchImageBuffer(postDraft.image);
  const jpeg = await composeFeedSlide(productImage, loadSelo(), postDraft.imageTitle ?? postDraft.title);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/api/admin/postdraft/id-story.test.ts tests/api/admin/postdraft/id-feed.test.ts`
Expected: PASS

- [ ] **Step 6: Run the full test suite**

Run: `npx vitest run`
Expected: PASS — all suites green, including Tasks 1-5's changes together.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/admin/postdraft/[id]/story/route.ts src/app/api/admin/postdraft/[id]/feed/route.ts tests/api/admin/postdraft/id-story.test.ts tests/api/admin/postdraft/id-feed.test.ts
git commit -m "feat: use imageTitle (falling back to title) when generating story/feed images"
```

---

### Task 6: `PostTitleModal` shared component

**Files:**
- Create: `src/app/admin/PostTitleModal.tsx`

**Interfaces:**
- Produces: `PostTitleModal` React component, props `{ initialTitle: string; submitting: boolean; onCancel: () => void; onConfirm: (imageTitle: string) => void }` — consumed by Task 7 (the three admin pages).

No automated test for this task: the project has no component-test infra (no `@testing-library/react`, no jsdom environment in `vitest.config.ts` — confirmed by inspecting `package.json` and `vitest.config.ts`, and by the absence of any `*.test.tsx` file in the repo). Verify this component visually as part of Task 7's manual verification.

- [ ] **Step 1: Create the component**

```tsx
"use client";

import { useState } from "react";

type PostTitleModalProps = {
  initialTitle: string;
  submitting: boolean;
  onCancel: () => void;
  onConfirm: (imageTitle: string) => void;
};

export default function PostTitleModal({
  initialTitle,
  submitting,
  onCancel,
  onConfirm,
}: PostTitleModalProps) {
  const [imageTitle, setImageTitle] = useState(initialTitle);
  const trimmed = imageTitle.trim();

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="post-title-modal-heading"
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 p-4"
    >
      <div className="w-full max-w-md rounded-2xl border border-ink-line bg-ink-raised p-6">
        <h2
          id="post-title-modal-heading"
          className="font-display font-stretch-condensed text-lg font-black tracking-tight text-paper uppercase italic"
        >
          Título na imagem
        </h2>
        <p className="mt-2 text-sm text-ash">
          Esse texto aparece no topo do story e do feed gerados. Edite se quiser.
        </p>

        <label className="mt-4 block">
          <span className="sr-only">Título para a imagem</span>
          <textarea
            required
            autoFocus
            value={imageTitle}
            onChange={(event) => setImageTitle(event.target.value)}
            rows={3}
            className="w-full resize-y rounded-xl border border-ink-line bg-ink p-3 text-sm text-paper placeholder:text-ash/60 focus-visible:border-gold focus-visible:ring-2 focus-visible:ring-gold/40 focus-visible:outline-none"
          />
        </label>

        <div className="mt-5 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="font-mono text-xs tracking-wider text-ash uppercase transition hover:text-paper focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => onConfirm(trimmed)}
            disabled={submitting || !trimmed}
            className="rounded-full bg-gold px-6 py-2.5 font-display font-stretch-condensed text-sm font-black tracking-wide text-ink uppercase italic transition hover:bg-paper focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-ink-raised focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "Selecionando…" : "Confirmar"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors from this file (it isn't wired up yet, so this only checks it compiles standalone).

- [ ] **Step 3: Commit**

```bash
git add src/app/admin/PostTitleModal.tsx
git commit -m "feat: add PostTitleModal component for editing the image title"
```

---

### Task 7: Wire the modal into the three marketplace admin pages

**Files:**
- Modify: `src/app/admin/amazon/AmazonAdmin.tsx`
- Modify: `src/app/admin/shopee/ShopeeAdmin.tsx`
- Modify: `src/app/admin/mercadolivre/MercadoLivreAdmin.tsx`

**Interfaces:**
- Consumes: `PostTitleModal` from Task 6; the `imageTitle`-aware `POST /api/admin/postdraft` from Task 3.

This is the same mechanical change applied identically in all three files (they share the exact same `handleSelectForPost`/button/`PoolItem` shape, confirmed by reading all three during planning). Apply it once per file.

- [ ] **Step 1: `AmazonAdmin.tsx` — import the modal and add pending-item state**

Add the import (top of file, after the `useCallback, useEffect, useState` import):

```tsx
import PostTitleModal from "@/app/admin/PostTitleModal";
```

Add state right after `const [removingId, setRemovingId] = useState<string | null>(null);` (line 47):

```tsx
  const [pendingItem, setPendingItem] = useState<PoolItem | null>(null);
```

- [ ] **Step 2: `AmazonAdmin.tsx` — change `handleSelectForPost` to accept `imageTitle`**

Replace the function (lines 132-164):

```tsx
  async function handleSelectForPost(item: PoolItem, imageTitle: string) {
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
```

- [ ] **Step 3: `AmazonAdmin.tsx` — open the modal instead of posting directly, and render it**

Change the button's `onClick` (line 399) from `() => handleSelectForPost(item)` to:

```tsx
                    onClick={() => setPendingItem(item)}
```

Add the modal render right before the closing `</div>` of the component's root `<div>` (after the "Carregar mais" block, before line 436's closing `</div>`):

```tsx
      </div>

      {pendingItem && (
        <PostTitleModal
          initialTitle={pendingItem.title}
          submitting={selectingId === pendingItem.id}
          onCancel={() => setPendingItem(null)}
          onConfirm={(imageTitle) => {
            void handleSelectForPost(pendingItem, imageTitle);
            setPendingItem(null);
          }}
        />
      )}
    </div>
  );
}
```

(This replaces the final `</div>\n  );\n}` at the end of the file — the outer `<div className="mt-8">` closes, then the modal is a sibling of it inside the component's top-level `<div>`.)

- [ ] **Step 4: Repeat Steps 1-3 for `ShopeeAdmin.tsx`**

Same import, same `pendingItem` state (add after `const [removingId, setRemovingId] = useState<string | null>(null);` at line 35), same `handleSelectForPost` signature change (replace lines 93-125, using `marketplace: "SHOPEE"`), same button `onClick` change (line 275), same modal render before the final closing tags (after line 311's "Carregar mais" block, before the closing `</div>` at line 312-313).

- [ ] **Step 5: Repeat Steps 1-3 for `MercadoLivreAdmin.tsx`**

Same import, same `pendingItem` state (add near the other `useState` declarations alongside `removingId`), same `handleSelectForPost` signature change (replace lines 158-190, using `marketplace: "MERCADO_LIVRE"`), same button `onClick` change (line 453), same modal render before the component's final closing tags.

- [ ] **Step 6: Type-check and run the full test suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no type errors, all tests PASS (this task touches no test files — it's UI wiring covered by manual verification below).

- [ ] **Step 7: Manual verification**

Run: `npm run dev`

1. Open `/admin/amazon` (or `/admin/shopee`, `/admin/mercadolivre`), log in.
2. Click "Selecionar para postar" on any item — confirm the modal opens, pre-filled with that item's title.
3. Edit the text, click "Confirmar" — confirm the button on the card shows "Selecionando…" then "Selecionado ✓".
4. Go to `/admin/postar` — find the item, confirm the story and feed images (rendered inline, and via "Baixar story"/"Baixar feed") show the edited text at the top, legible over the product photo.
5. Repeat without editing the text — confirm the original card title appears in the image.
6. Repeat with a very long title — confirm it wraps onto multiple lines without overflowing the image width.
7. Click "Selecionar para postar" then "Cancelar" — confirm no request is sent and the item is not marked as selected.

- [ ] **Step 8: Commit**

```bash
git add src/app/admin/amazon/AmazonAdmin.tsx src/app/admin/shopee/ShopeeAdmin.tsx src/app/admin/mercadolivre/MercadoLivreAdmin.tsx
git commit -m "feat: open PostTitleModal on select-for-post across all marketplace admins"
```
