# Price Timestamp on Vitrine Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the price-capture time ("Preço às HH:mm") on each public vitrine card, using the existing `Highlight.createdAt` field, to satisfy the Amazon Associates policy requirement that displayed prices carry a date/time stamp.

**Architecture:** A pure formatting helper (`formatBrazilTime`) added next to the existing `startOfTodayInBrazil` in `src/lib/date.ts`, consumed directly by the `VitrineHighlights` client component. No schema change, no new data fetch — `createdAt` is already selected and passed to the component today.

**Tech Stack:** Next.js (App Router), TypeScript, Prisma, Vitest, Tailwind CSS.

## Global Constraints

- No schema/migration changes — `Highlight.createdAt` (`prisma/schema.prisma:94`) already captures the price snapshot moment and is never updated after creation.
- Format: time only, e.g. `"14:32"`, in `America/Sao_Paulo` — no date portion (per approved spec, since the vitrine only ever shows today's highlights).
- Displayed text: `Preço às {HH:mm}`.

---

### Task 1: Add `formatBrazilTime` helper with test

**Files:**
- Modify: `src/lib/date.ts`
- Test: `tests/lib/date.test.ts`

**Interfaces:**
- Produces: `formatBrazilTime(date: Date): string` — exported from `src/lib/date.ts`, returns a `"HH:mm"` string (24h, zero-padded) for the given `Date`, formatted in the `America/Sao_Paulo` time zone.

- [ ] **Step 1: Write the failing test**

Add to `tests/lib/date.test.ts` (new `describe` block, keep the existing `startOfTodayInBrazil` block untouched):

```ts
import { describe, it, expect } from "vitest";
import { startOfTodayInBrazil, formatBrazilTime } from "@/lib/date";

// ... existing startOfTodayInBrazil describe block stays as-is ...

describe("formatBrazilTime", () => {
  it("formats a UTC instant as HH:mm in America/Sao_Paulo", () => {
    const date = new Date("2026-08-07T17:32:00.000Z"); // 14:32 in America/Sao_Paulo (UTC-3)
    expect(formatBrazilTime(date)).toBe("14:32");
  });

  it("zero-pads single-digit hours and minutes", () => {
    const date = new Date("2026-08-07T12:05:00.000Z"); // 09:05 in America/Sao_Paulo
    expect(formatBrazilTime(date)).toBe("09:05");
  });

  it("rolls into the previous day in Brazil without affecting the time shown", () => {
    const date = new Date("2026-08-07T02:15:00.000Z"); // 23:15 on Aug 6 in America/Sao_Paulo
    expect(formatBrazilTime(date)).toBe("23:15");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/lib/date.test.ts`
Expected: FAIL — `formatBrazilTime` is not exported from `@/lib/date` (TypeScript/import error or `undefined is not a function`).

- [ ] **Step 3: Implement `formatBrazilTime`**

Add to `src/lib/date.ts` (below the existing `startOfTodayInBrazil`, keep that function unchanged):

```ts
export function formatBrazilTime(date: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}
```

Note: `hourCycle: "h23"` is required so midnight formats as `"00:XX"` rather than `"24:XX"`, and to guarantee 24h formatting regardless of runtime ICU defaults for `pt-BR`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/lib/date.test.ts`
Expected: PASS (5 tests: 2 existing `startOfTodayInBrazil` + 3 new `formatBrazilTime`).

- [ ] **Step 5: Commit**

```bash
git add src/lib/date.ts tests/lib/date.test.ts
git commit -m "feat: add formatBrazilTime helper for price timestamps"
```

---

### Task 2: Render the price timestamp on vitrine cards

**Files:**
- Modify: `src/app/VitrineHighlights.tsx:22-24` (near `formatPrice`), `:123-132` (price block)

**Interfaces:**
- Consumes: `formatBrazilTime(date: Date): string` from `@/lib/date` (Task 1).
- Consumes: `highlight.createdAt` — already present on every `Highlight` object passed into this component (`prisma/schema.prisma:94`), no fetch/prop change needed.

- [ ] **Step 1: Import the helper**

In `src/app/VitrineHighlights.tsx`, add to the top-level imports (below the existing `Highlight` type import):

```tsx
import { formatBrazilTime } from "@/lib/date";
```

- [ ] **Step 2: Add the timestamp span to the price block**

In `src/app/VitrineHighlights.tsx`, the price block currently reads (lines 123-132):

```tsx
              <div className="flex items-baseline gap-2">
                <span className="font-display font-stretch-condensed text-xl leading-none font-black tracking-tight text-ink tabular-nums">
                  {formatPrice(highlight.price)}
                </span>
                {highlight.oldPrice !== null && (
                  <span className="font-mono text-xs text-ash line-through tabular-nums">
                    {formatPrice(highlight.oldPrice)}
                  </span>
                )}
              </div>
```

Replace it with (adds a timestamp line right below the price row, styled like the existing "Link patrocinado" caption at the bottom of the card):

```tsx
              <div className="flex items-baseline gap-2">
                <span className="font-display font-stretch-condensed text-xl leading-none font-black tracking-tight text-ink tabular-nums">
                  {formatPrice(highlight.price)}
                </span>
                {highlight.oldPrice !== null && (
                  <span className="font-mono text-xs text-ash line-through tabular-nums">
                    {formatPrice(highlight.oldPrice)}
                  </span>
                )}
              </div>
              <p className="font-mono text-[10px] tracking-wider text-ink/50 uppercase">
                Preço às {formatBrazilTime(highlight.createdAt)}
              </p>
```

- [ ] **Step 3: Run the existing test suite to confirm nothing broke**

Run: `npx vitest run`
Expected: PASS — all existing tests green (this component has no dedicated unit test today; this step guards against unrelated regressions, e.g. in `tests/smoke.test.ts` if it touches the homepage).

- [ ] **Step 4: Manual verification**

Run: `npm run dev`
Open `http://localhost:3000` in a browser, confirm at least one highlight card shows a line reading `PREÇO ÀS HH:MM` (uppercase via the `uppercase` class) directly below the price, and that the time is plausible for the current moment in Brazil.

- [ ] **Step 5: Commit**

```bash
git add src/app/VitrineHighlights.tsx
git commit -m "feat: show price capture time on vitrine cards"
```
