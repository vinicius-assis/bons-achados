import { prisma } from "@/lib/prisma";

const ML_TOKEN_URL = "https://api.mercadolibre.com/oauth/token";

export async function refreshAccessToken(): Promise<string> {
  const stored = await prisma.mercadoLivreAuth.findUnique({ where: { id: 1 } });
  if (!stored) {
    throw new Error(
      "Mercado Livre auth not configured — visit /api/mercadolivre/oauth/start to authorize"
    );
  }

  const response = await fetch(ML_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: process.env.ML_CLIENT_ID!,
      client_secret: process.env.ML_CLIENT_SECRET!,
      refresh_token: stored.refreshToken,
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`Mercado Livre token refresh failed: ${response.status}`);
  }

  const data = await response.json();

  if (
    typeof data.access_token !== "string" ||
    !data.access_token ||
    typeof data.refresh_token !== "string" ||
    !data.refresh_token
  ) {
    throw new Error("Mercado Livre token response missing access_token or refresh_token");
  }

  const result = await prisma.mercadoLivreAuth.updateMany({
    where: { id: 1, refreshToken: stored.refreshToken },
    data: { accessToken: data.access_token, refreshToken: data.refresh_token },
  });

  if (result.count === 0) {
    throw new Error("Mercado Livre token was rotated concurrently, retry");
  }

  return data.access_token as string;
}
