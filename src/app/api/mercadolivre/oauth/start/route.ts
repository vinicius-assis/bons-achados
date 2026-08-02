import { NextResponse } from "next/server";
import {
  generateCodeVerifier,
  codeChallengeFromVerifier,
  generateState,
} from "@/lib/mercadolivre/pkce";

const ML_AUTH_URL = "https://auth.mercadolivre.com.br/authorization";

export async function GET() {
  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = codeChallengeFromVerifier(codeVerifier);

  const url = new URL(ML_AUTH_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", process.env.ML_CLIENT_ID!);
  url.searchParams.set("redirect_uri", process.env.ML_REDIRECT_URI!);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");

  const response = NextResponse.redirect(url);
  const cookieOptions = {
    httpOnly: true,
    secure: true,
    sameSite: "lax" as const,
    maxAge: 600,
    path: "/",
  };
  response.cookies.set("ml_oauth_state", state, cookieOptions);
  response.cookies.set("ml_oauth_verifier", codeVerifier, cookieOptions);

  return response;
}
