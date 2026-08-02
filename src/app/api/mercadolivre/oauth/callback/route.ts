import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const ML_TOKEN_URL = "https://api.mercadolibre.com/oauth/token";

function clearOAuthCookies(response: NextResponse): NextResponse {
  response.cookies.delete("ml_oauth_state");
  response.cookies.delete("ml_oauth_verifier");
  response.cookies.delete("ml_oauth_authorized");
  return response;
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const errorParam = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = request.cookies.get("ml_oauth_state")?.value;
  const codeVerifier = request.cookies.get("ml_oauth_verifier")?.value;
  const authorized = request.cookies.get("ml_oauth_authorized")?.value;

  if (errorParam) {
    return clearOAuthCookies(
      NextResponse.json(
        { error: "Mercado Livre authorization was denied or failed", detail: errorParam },
        { status: 400 }
      )
    );
  }

  if (!authorized) {
    return clearOAuthCookies(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
  }

  if (!code || !state || !cookieState || !codeVerifier || state !== cookieState) {
    return clearOAuthCookies(
      NextResponse.json({ error: "Invalid OAuth state" }, { status: 400 })
    );
  }

  const tokenResponse = await fetch(ML_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: process.env.ML_CLIENT_ID!,
      client_secret: process.env.ML_CLIENT_SECRET!,
      code,
      redirect_uri: process.env.ML_REDIRECT_URI!,
      code_verifier: codeVerifier,
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!tokenResponse.ok) {
    return clearOAuthCookies(
      NextResponse.json(
        { error: `Token exchange failed: ${tokenResponse.status}` },
        { status: 502 }
      )
    );
  }

  const data = await tokenResponse.json();

  if (typeof data.access_token !== "string" || !data.access_token ||
      typeof data.refresh_token !== "string" || !data.refresh_token) {
    return clearOAuthCookies(
      NextResponse.json(
        { error: "Mercado Livre token response missing access_token or refresh_token" },
        { status: 502 }
      )
    );
  }

  await prisma.mercadoLivreAuth.upsert({
    where: { id: 1 },
    create: { id: 1, accessToken: data.access_token, refreshToken: data.refresh_token },
    update: { accessToken: data.access_token, refreshToken: data.refresh_token },
  });

  return clearOAuthCookies(NextResponse.json({ authorized: true }));
}
