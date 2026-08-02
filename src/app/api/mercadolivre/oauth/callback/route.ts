import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const ML_TOKEN_URL = "https://api.mercadolibre.com/oauth/token";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = request.cookies.get("ml_oauth_state")?.value;
  const codeVerifier = request.cookies.get("ml_oauth_verifier")?.value;

  if (!code || !state || !cookieState || !codeVerifier || state !== cookieState) {
    return NextResponse.json({ error: "Invalid OAuth state" }, { status: 400 });
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
  });

  if (!tokenResponse.ok) {
    return NextResponse.json(
      { error: `Token exchange failed: ${tokenResponse.status}` },
      { status: 502 }
    );
  }

  const data = await tokenResponse.json();

  await prisma.mercadoLivreAuth.upsert({
    where: { id: 1 },
    create: { id: 1, accessToken: data.access_token, refreshToken: data.refresh_token },
    update: { accessToken: data.access_token, refreshToken: data.refresh_token },
  });

  const response = NextResponse.json({ authorized: true });
  response.cookies.delete("ml_oauth_state");
  response.cookies.delete("ml_oauth_verifier");

  return response;
}
