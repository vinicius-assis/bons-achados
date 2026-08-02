# Mercado Livre OAuth Design

## Problem

The public Mercado Livre search API (`GET /sites/MLB/search`) and reviews API (`GET /reviews/item/{id}`), used unauthenticated by `MercadoLivreClient`, started returning `403 Forbidden` (`PA_UNAUTHORIZED_RESULT_FROM_POLICIES`) as of a Mercado Livre platform-wide policy change effective January 2026. This blocks the entire automatic collection pipeline built in `docs/superpowers/plans/2026-08-01-foundation-ml-collection.md`. Confirmed via direct `curl` against the live endpoint (independent of this app's code) and corroborated by multiple developer reports (Reclame Aqui threads, January 2026 onward).

Mercado Livre's current API only supports the OAuth 2.0 `authorization_code` grant (requires one-time interactive login/consent by a seller account) plus `refresh_token` grant for renewal — there is no `client_credentials` (server-to-server, no-login) option for this use case. Access tokens last 6 hours; refresh tokens rotate on every use and expire after 6 months of inactivity.

## Goal

Restore automatic Mercado Livre collection by authenticating all `api.mercadolibre.com` calls with a Bearer access token, obtained once through a manual OAuth authorization, and kept alive automatically afterward without further manual intervention.

## Non-goals

- Multi-seller / multi-account support (single ML account for the whole app).
- Handling the case where the refresh token expires from 6 months of inactivity (out of scope; if the cron runs regularly this won't happen — if it does, re-running the manual bootstrap fixes it).
- Building any UI for the OAuth flow beyond the two required redirect routes.

## Architecture / Data Flow

```
[Manual, one-time bootstrap]
  You (browser) -> GET /api/mercadolivre/oauth/start
                      -> redirects to ML's authorize URL (client_id, redirect_uri, state, PKCE code_challenge)
  You log in / approve on Mercado Livre
  ML -> GET /api/mercadolivre/oauth/callback?code=...&state=...
                      -> validates state, exchanges code for {access_token, refresh_token}
                      -> upserts MercadoLivreAuth row in Neon

[Automatic, every /api/collect run]
  Cron (GitHub Actions) -> POST /api/collect (x-collect-secret)
                              -> refreshAccessToken()
                                   -> reads stored refresh_token from MercadoLivreAuth
                                   -> POST https://api.mercadolibre.com/oauth/token (grant_type=refresh_token)
                                   -> saves the NEW {access_token, refresh_token} pair (rotation)
                              -> MercadoLivreClient(accessToken) attaches `Authorization: Bearer <token>`
                              -> searchProducts / getItemReviews as today
                              -> upsertProducts as today
```

Refresh happens unconditionally at the start of every collection run — no `expires_in`/expiry tracking is needed, since a fresh token is always requested before use.

## Components

- **`prisma/schema.prisma`**: new model `MercadoLivreAuth` — single-row table (`id Int @id @default(1)`, `accessToken String`, `refreshToken String`, `updatedAt DateTime @updatedAt`).
- **`src/app/api/mercadolivre/oauth/start/route.ts`**: builds the ML authorization URL (`client_id`, `redirect_uri`, `response_type=code`, `state`, PKCE `code_challenge`/`code_challenge_method=S256`) and redirects. Generates and stores the PKCE `code_verifier` + `state` (short-lived, e.g. a signed cookie) to validate in the callback.
- **`src/app/api/mercadolivre/oauth/callback/route.ts`**: validates `state` against the value issued by `start` (CSRF protection), exchanges `code` (+ `code_verifier`) for `{access_token, refresh_token}` via `POST https://api.mercadolibre.com/oauth/token`, upserts the single `MercadoLivreAuth` row.
- **`src/lib/mercadolivre/auth.ts`**: `refreshAccessToken()` — reads the stored `refreshToken`, calls `grant_type=refresh_token`, persists the new pair, returns the new `accessToken`. Throws a descriptive error if the stored row is missing or the ML token endpoint rejects the refresh (e.g., expired/revoked).
- **`src/lib/mercadolivre/client.ts`**: `MercadoLivreClient` constructor takes an `accessToken`; `searchProducts` and `getItemReviews` send `Authorization: Bearer <accessToken>`.
- **`src/lib/mercadolivre/collect.ts`** (or `/api/collect` route): calls `refreshAccessToken()` before constructing `MercadoLivreClient`.
- **New env vars**: `ML_CLIENT_ID`, `ML_CLIENT_SECRET` (from the registered ML app), `ML_REDIRECT_URI` (e.g. `https://bons-achados-teal.vercel.app/api/mercadolivre/oauth/callback`).

## Error Handling

- `refreshAccessToken()` failure (revoked/expired refresh token) surfaces as a `500` from `/api/collect` with a clear message ("Mercado Livre auth expired — repeat manual authorization at /api/mercadolivre/oauth/start"), so it's visible in GitHub Actions run logs instead of silently collecting 0 items.
- `oauth/callback` rejects (400) if `state` doesn't match the one issued by `oauth/start`.
- `oauth/start` and `oauth/callback` are intentionally not protected by `COLLECT_SECRET` (they're a manual, one-time, interactive flow) but validate `state` to prevent CSRF.

## Testing

- `refreshAccessToken()`: unit test mocking `fetch` and the Prisma client, asserting the new token pair is persisted.
- `MercadoLivreClient`: existing tests updated to assert the `Authorization: Bearer` header is sent on both `searchProducts` and `getItemReviews`.
- `oauth/callback`: unit test asserting a `state` mismatch is rejected before any token exchange is attempted.

## Manual Bootstrap Steps (one-time, after implementation ships)

1. Deploy the implementation to Vercel (already live at `https://bons-achados-teal.vercel.app`).
2. Run `npx prisma migrate deploy` against Neon to create `MercadoLivreAuth`.
3. Register an application at developers.mercadolivre.com.br with `redirect_uri = https://bons-achados-teal.vercel.app/api/mercadolivre/oauth/callback`; copy `client_id`/`client_secret` into Vercel env vars (`ML_CLIENT_ID`, `ML_CLIENT_SECRET`, `ML_REDIRECT_URI`).
4. Visit `https://bons-achados-teal.vercel.app/api/mercadolivre/oauth/start` in a browser, log in with the ML affiliate account, approve.
5. Call `POST /api/collect` again and confirm `{ "collected": N }` with `N > 0`.
