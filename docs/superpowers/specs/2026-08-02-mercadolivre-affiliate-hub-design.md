# Mercado Livre Affiliate Hub Design

## Problem

The Mercado Livre OAuth integration built in `docs/superpowers/specs/2026-08-02-mercadolivre-oauth-design.md` correctly obtains and refreshes an access token, but the token does not unlock `/sites/MLB/search` or `/reviews/item/{id}` — both still return `403 PA_UNAUTHORIZED_RESULT_FROM_POLICIES` even when authenticated. Confirmed live: `GET /users/me` with the same token returns `200`, so the token itself is valid; the search/reviews endpoints are blocked platform-wide for this kind of access regardless of auth. Mercado Livre's affiliate program has no public API for product discovery.

However, the browser-based Affiliate Hub (`mercadolivre.com.br/afiliados/hub`) — the tool ML gives affiliates to find products — has its own internal, undocumented API, authenticated via the logged-in browser session (cookies), not OAuth:

- `POST https://www.mercadolivre.com.br/affiliate-program/api/hub/search?is_affiliate=true&device=desktop` — returns a rich product listing (title, price, previous price, discount, rating, sold-count, image, permalink, commission %) as "polycards."
- `POST https://www.mercadolivre.com.br/affiliate-program/api/v2/affiliates/createLink` — given a product URL, returns a short affiliate link already carrying `matt_word`/`matt_tool`.

Both were confirmed working live with a real session on 2026-08-02.

## Goal

Replace the (non-functional-for-this-purpose) OAuth-based collection with an admin-only, on-demand tool: paste the session cookies once, search Mercado Livre's affiliate catalog from a browser page, and generate an affiliate link per item with one click — no cron, no automatic `Product` writes.

## Non-goals

- No automatic/scheduled collection for Mercado Livre (removed; the GitHub Actions cron this repo had was ML-only, so it becomes dormant until Amazon/Shopee or a future ML path needs it).
- No automated session refresh (no login automation) — cookies are pasted manually when they expire; the tool must fail with a clear, actionable error when they do.
- No automatic insertion into the `Product` table — this tool only displays results and generates links; publishing selected items into `Product` is a future feature (Week 2+ of the roadmap).
- Multi-user auth, roles, or anything beyond a single shared admin credential.

## Architecture / Data Flow

```
[One-time or occasional, when cookies expire]
  You → GET /admin/mercadolivre (Basic Auth: any user, ADMIN_PASSWORD)
      → paste cookieHeader + x-csrf-token → POST /api/admin/mercadolivre/session
      → saved as the single MercadoLivreSession row in Neon

[On demand, whenever you want to browse]
  You → type a search term → click "Listar produtos"
      → GET /api/admin/mercadolivre/search?q=...
          → reads MercadoLivreSession
          → POST to ML's hub search endpoint with those cookies
          → parses polycards into a flat list: {itemId, title, price, oldPrice,
            discount, rating, soldQuantity, image, permalink}
          → for each item, checks MercadoLivreGeneratedLink for a same-day row
            matching itemId; marks it generatedToday: true/false
      → page renders a grid: image, title, price/oldPrice/discount, rating,
        a "Gerar link" button (shows "Já gerado hoje" state if generatedToday)

  You → click "Gerar link" on an item
      → POST /api/admin/mercadolivre/generate-link { itemId, url, title }
          → reads MercadoLivreSession
          → POST to ML's createLink endpoint with those cookies
          → records a MercadoLivreGeneratedLink row (itemId, title, affiliateLink)
          → returns the link
      → page shows the link inline (copyable) and flips the button to "Já gerado hoje"
```

If the ML session has expired, both API routes return a distinct error the page surfaces as "Sessão expirada — cole os cookies de novo em /admin/mercadolivre" rather than a generic failure.

## Data Model

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

"Already generated today" is computed as: a `MercadoLivreGeneratedLink` row exists with this `mlItemId` and `generatedAt >= start of today (server-local date)`.

## Components

- **`middleware.ts`** — HTTP Basic Auth gate on `/admin/*` and `/api/admin/*`, checking the `Authorization: Basic` header against `ADMIN_USER`/`ADMIN_PASSWORD` env vars. Everything else on the site is unaffected.
- **`src/lib/mercadolivre/session.ts`** — `getSession(): Promise<{cookieHeader, csrfToken} | null>`, `saveSession(cookieHeader, csrfToken): Promise<void>`, backed by the single-row `MercadoLivreSession` table (same `id: 1` singleton pattern as the removed `MercadoLivreAuth`).
- **`src/lib/mercadolivre/hubClient.ts`** — `searchAffiliateProducts(query: string, session): Promise<MLHubItem[]>`. Parses the hub search response's `polycard_client_model.polycards[]` into a flat `MLHubItem` type. Throws a distinct `MercadoLivreSessionExpiredError` when the response isn't a successful product listing (auth-shaped failure), separate from other errors.
- **`src/lib/mercadolivre/createLink.ts`** — `createAffiliateLink(url: string, session): Promise<{shortUrl: string; longUrl: string}>`, calls ML's `createLink`, and `recordGeneratedLink(mlItemId, title, affiliateLink)` writing to `MercadoLivreGeneratedLink`.
- **`src/app/admin/mercadolivre/page.tsx`** — the page: session form (shown when no session saved, or after an expired-session error), search input + "Listar produtos" button, results grid, per-item "Gerar link" button with generated/not-generated state. Client component calling the API routes below.
- **`src/app/api/admin/mercadolivre/session/route.ts`** — `POST`, body `{cookieHeader, csrfToken}`, calls `saveSession`.
- **`src/app/api/admin/mercadolivre/search/route.ts`** — `GET ?q=`, calls `searchAffiliateProducts` + annotates `generatedToday`.
- **`src/app/api/admin/mercadolivre/generate-link/route.ts`** — `POST`, body `{itemId, url, title}`, calls `createAffiliateLink` + `recordGeneratedLink`.

## Removed

- `src/app/api/mercadolivre/oauth/start/route.ts`, `.../callback/route.ts`
- `src/lib/mercadolivre/auth.ts`, `src/lib/mercadolivre/pkce.ts`
- `src/lib/mercadolivre/client.ts` (the public-API-based client; `searchProducts`/`getItemReviews` are dead — the public endpoints are blocked regardless of auth)
- `src/lib/mercadolivre/collect.ts`, and the Mercado Livre-specific logic in `src/app/api/collect/route.ts` (the route itself may stay as a stub returning "no automatic sources configured" for future Amazon/Shopee use, or be removed entirely — decided in the implementation plan)
- `MercadoLivreAuth` Prisma model (migration to drop it)
- All associated tests: `tests/mercadolivre/auth.test.ts`, `tests/mercadolivre/pkce.test.ts`, `tests/mercadolivre/client.test.ts`, `tests/mercadolivre/collect.test.ts`, `tests/api/mercadolivre/oauth/*.test.ts`, `tests/api/collect.test.ts` (removed or reduced to whatever the decided stub behavior is)
- `.github/workflows/collect.yml` — the ML-only cron becomes meaningless; disable or remove (decided in the implementation plan)
- `ML_CLIENT_ID`, `ML_CLIENT_SECRET`, `ML_REDIRECT_URI` env vars (no longer used)

## New Env Vars

- `ADMIN_USER`, `ADMIN_PASSWORD` — Basic Auth credentials for `/admin/*`.
- `ML_AFFILIATE_WORD`, `ML_AFFILIATE_TOOL` — unchanged, still used to build affiliate links (kept from the original design, though `createLink` already returns a link carrying them — the mapper's manual link-building becomes redundant and is not reused in this feature; `createLink`'s output is authoritative).

## Error Handling

- `hubClient.ts` and `createLink.ts` both throw `MercadoLivreSessionExpiredError` for auth-shaped failures (non-2xx, or a 2xx body that doesn't match the expected shape), which the API routes map to a `401` with `{ error: "session_expired" }`; other failures map to `502` with a generic message. The admin page distinguishes these to show the right UI state.
- Frontend design work (the `/admin/mercadolivre` page layout) follows the `frontend-design` skill (anthropics/skills, installed this session) — invoke it before writing the page's markup/styling.

## Testing

- `session.ts`: read/write against a mocked Prisma client.
- `hubClient.ts`: parses a fixture payload (a trimmed real response captured during this session) into the expected `MLHubItem[]`; a distinct test for the session-expired error path.
- `createLink.ts`: successful call records a `MercadoLivreGeneratedLink` row; session-expired path throws without recording.
- `search`/`generate-link` API routes: auth passthrough, session-expired mapping to 401, `generatedToday` computed correctly for a same-day vs. prior-day fixture row.
- `middleware.ts`: request without/with wrong/with correct Basic Auth header on an `/admin` path.

## Manual Verification (after implementation)

1. Deploy; set `ADMIN_USER`/`ADMIN_PASSWORD` in Vercel; run the new migration (drop `MercadoLivreAuth`, add the two new tables) against Neon.
2. Visit `/admin/mercadolivre` — confirm the browser's Basic Auth prompt appears and rejects a wrong password.
3. Paste real cookies + csrf token from a fresh browser inspection; confirm they save.
4. Search a term; confirm real results render with title/price/discount/rating/image.
5. Generate a link for one item; confirm it matches the `createLink` shape seen in this session's manual testing, and that the button flips to "already generated today."
6. Re-search the same term; confirm that item still shows as generated today.
