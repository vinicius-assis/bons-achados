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
  });

  if (!response.ok) {
    throw new Error(`Mercado Livre token refresh failed: ${response.status}`);
  }

  const data = await response.json();

  await prisma.mercadoLivreAuth.update({
    where: { id: 1 },
    data: { accessToken: data.access_token, refreshToken: data.refresh_token },
  });

  return data.access_token as string;
}
