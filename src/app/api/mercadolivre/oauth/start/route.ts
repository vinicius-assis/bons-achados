import { NextRequest, NextResponse } from "next/server";
import {
  generateCodeVerifier,
  codeChallengeFromVerifier,
  generateState,
} from "@/lib/mercadolivre/pkce";

export const dynamic = "force-dynamic";

const ML_AUTH_URL = "https://auth.mercadolivre.com.br/authorization";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const secret = url.searchParams.get("secret");
  if (secret !== process.env.COLLECT_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = codeChallengeFromVerifier(codeVerifier);

  const authorizeUrl = new URL(ML_AUTH_URL);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", process.env.ML_CLIENT_ID!);
  authorizeUrl.searchParams.set("redirect_uri", process.env.ML_REDIRECT_URI!);
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("code_challenge", codeChallenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  authorizeUrl.searchParams.set("scope", "offline_access read");

  const response = NextResponse.redirect(authorizeUrl);
  const cookieOptions = {
    httpOnly: true,
    secure: true,
    sameSite: "lax" as const,
    maxAge: 600,
    path: "/",
  };
  response.cookies.set("ml_oauth_state", state, cookieOptions);
  response.cookies.set("ml_oauth_verifier", codeVerifier, cookieOptions);
  response.cookies.set("ml_oauth_authorized", "1", cookieOptions);

  return response;
}
