# Amazon Affiliate Hub Design

## Problem

Amazon's Associates program has no public product-search API accessible to this project. However, the "Ofertas do mês" deals page (`amazon.com.br/events/ofertasmensais`) is backed by an internal, undocumented endpoint authenticated purely via the logged-in browser session (cookies, no CSRF header):

- `GET https://www.amazon.com.br/d2b/api/v1/products/search?...` — returns paginated deal products (`LIGHTNING_DEAL`/`BEST_DEAL` only) with title, price, previous price, discount badge, and image.

Confirmed working live with a real session on 2026-08-05, both right after capture and again with `pageSize` bumped to 100 — same session, no rotation observed.

Unlike Mercado Livre, this endpoint has no free-text search parameter — it only lists whatever deals Amazon is currently running. Also unlike ML, generating an affiliate link needs no API call at all: appending `?tag=<associate-tag>` to a product URL is Amazon's standard, officially-supported affiliate link format and never expires. The captured SiteStripe `getShortUrl` curl was rejected as a basis for this feature — it depends on `sbo`/`linkId` params generated per page load for one specific product, which can't be reconstructed for arbitrary ASINs from search results.

## Goal

An admin-only, on-demand tool mirroring `/admin/mercadolivre`: paste session cookies once, browse Amazon's current deals from a page in this app, and get a ready-to-use affiliate link per item — no cron, no automatic `Product` writes, no search box (there's nothing to search).

## Non-goals

- No free-text search — only the deals-page listing this endpoint provides. If a text-search endpoint is found later, it's a separate change.
- No automated session refresh — cookies pasted manually when they expire, same as ML.
- No automatic insertion into `Product` — this tool only lists results and lets the admin select items into `PostDraft`/`Highlight`, same as ML.
- No link-generation API call, no per-link expiry/dedup tracking — the affiliate link is a pure string computation from the ASIN, always available, never "already generated today."

## Architecture / Data Flow

```
[One-time or occasional, when cookies expire]
  You → GET /admin/amazon (Basic Auth)
      → paste cookieHeader → POST /api/admin/amazon/session
      → saved as the single AmazonSession row in Neon

[On demand, whenever you want to browse]
  You → open /admin/amazon (loads automatically, no query to type)
      → GET /api/admin/amazon/deals?offset=0
          → reads AmazonSession
          → GET to Amazon's d2b products/search endpoint with those cookies
          → parses products[] into a flat list: {asin, title, price, oldPrice,
            discountLabel, image, permalink, affiliateLink}
            (affiliateLink built locally as amazon.com.br/dp/{asin}?tag=...,
            no network call)
      → page renders a grid: image, title, price/oldPrice/discount, and the
        affiliate link ready to copy/select-for-post/highlight immediately
      → "Carregar mais" repeats the call with the API's own nextIndex
```

If the Amazon session has expired, the API route returns a distinct error the page surfaces as "Sessão expirada — cole os cookies de novo" rather than a generic failure.

## Data Model

```prisma
model AmazonSession {
  id           Int      @id @default(1)
  cookieHeader String
  updatedAt    DateTime @updatedAt
}
```

No generated-link table: there's nothing to dedup or expire, since the link is a deterministic function of the ASIN.

## Components

- **`src/lib/amazon/session.ts`** — `getSession(): Promise<{cookieHeader} | null>`, `saveSession(cookieHeader): Promise<void>`, backed by the single-row `AmazonSession` table (same `id: 1` singleton pattern as `MercadoLivreSession`).
- **`src/lib/amazon/parseCurl.ts`** — extracts only the `Cookie` header from a pasted "Copy as cURL" (Amazon's curl has no separate CSRF header, unlike ML's).
- **`src/lib/amazon/hubClient.ts`** — `listDeals(offset: number, session): Promise<{items: AmazonDealItem[]; nextIndex: number | null}>`. Calls the `d2b/api/v1/products/search` endpoint with the same query params captured in `amazon-produtos-curl.md` (fixed filters, `pageSize=30`), parses `products[]`, builds `affiliateLink` from `asin` + `AMAZON_AFFILIATE_TAG`. Throws `AmazonSessionExpiredError` when the response isn't a successful listing (matches the `hubClient.ts` pattern from ML).
- **`src/lib/mercadolivre/discountLabel.ts`**'s `parseDiscountPercentage` is reused as-is (imported, not duplicated) — it's already a marketplace-agnostic regex over a label string, and Amazon's `"26% off"` matches it the same as ML's discount labels.
- **`src/app/admin/amazon/page.tsx`** + **`AmazonAdmin.tsx`** — the page: session form (shown when no session saved, or after an expired-session error), results grid loaded automatically on session-ready (no search input), "Carregar mais" pagination, per-item copy/select-for-post/highlight buttons active immediately (no "gerar link" step or state).
- **`src/app/api/admin/amazon/session/route.ts`** — `GET` (has-session check) / `POST` (body `{curlCommand}`, calls `parseCurlCommand` + `saveSession`).
- **`src/app/api/admin/amazon/deals/route.ts`** — `GET ?offset=`, calls `listDeals`.

`select-for-post` and `highlight` reuse the existing `/api/admin/postdraft` and `/api/admin/highlights` routes with `marketplace: "AMAZON"` (already a valid `Marketplace` enum value) — no changes needed there.

## New Env Vars

- `AMAZON_AFFILIATE_TAG` — the Associates tracking tag (currently hardcoded as `bonsachados0f-20` in the captured curl), used to build every affiliate link.

## Error Handling

- `hubClient.ts` throws `AmazonSessionExpiredError` for auth-shaped failures (non-2xx, or a 2xx body that doesn't match the expected `{products: [...]}` shape — this is also how the anti-bot rejection we saw from Shopee would present here, if Amazon's WAF ever did the same), which the API route maps to `401` with `{ error: "session_expired" }`; other failures map to `502`.
- Frontend work for `/admin/amazon` follows the `frontend-design` skill, same as ML's page.

## Testing

- `session.ts`: read/write against a mocked Prisma client.
- `parseCurl.ts`: extracts the cookie header from a real captured curl fixture; returns `null` when no cookie header is present.
- `hubClient.ts`: parses a fixture payload (the response captured during this session, trimmed) into the expected `AmazonDealItem[]`, including `affiliateLink` construction; a distinct test for the session-expired error path.
- `deals` API route: auth passthrough, session-expired mapping to 401.

## Manual Verification (after implementation)

1. Run the new migration (add `AmazonSession`) against Neon; set `AMAZON_AFFILIATE_TAG` in Vercel.
2. Visit `/admin/amazon` — confirm Basic Auth gate.
3. Paste real cookies from a fresh browser inspection of the ofertasmensais page network tab; confirm they save.
4. Confirm the deals grid loads automatically with real title/price/discount/image, and every card already has a working affiliate link.
5. Click "Carregar mais"; confirm the next page of deals appends using the API's own `nextIndex`.
6. Open one generated affiliate link in a private window; confirm it lands on the product page with the tag applied (visible in the URL).
