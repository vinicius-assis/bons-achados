import { prisma } from "@/lib/prisma";
import type { MLHubSession } from "@/lib/mercadolivre/session";
import { MercadoLivreSessionExpiredError } from "@/lib/mercadolivre/hubClient";

const CREATE_LINK_URL =
  "https://www.mercadolivre.com.br/affiliate-program/api/v2/affiliates/createLink";

export type AffiliateLinkResult = {
  shortUrl: string;
  longUrl: string;
};

export async function createAffiliateLink(
  url: string,
  session: MLHubSession
): Promise<AffiliateLinkResult> {
  const response = await fetch(CREATE_LINK_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/plain, */*",
      origin: "https://www.mercadolivre.com.br",
      referer: "https://www.mercadolivre.com.br/afiliados/linkbuilder",
      cookie: session.cookieHeader,
      "x-csrf-token": session.csrfToken,
    },
    body: JSON.stringify({ urls: [url], tag: process.env.ML_AFFILIATE_WORD ?? "" }),
    signal: AbortSignal.timeout(10_000),
  });

  if (response.status === 401 || response.status === 403) {
    throw new MercadoLivreSessionExpiredError();
  }
  if (!response.ok) {
    throw new Error(`Mercado Livre createLink failed: ${response.status}`);
  }

  const data = await response.json();
  const result = data?.urls?.[0];
  if (!result?.short_url || !result?.long_url) {
    throw new Error("Mercado Livre createLink response missing short_url/long_url");
  }

  return { shortUrl: result.short_url, longUrl: result.long_url };
}

export async function recordGeneratedLink(
  mlItemId: string,
  title: string,
  affiliateLink: string
): Promise<void> {
  await prisma.mercadoLivreGeneratedLink.create({
    data: { mlItemId, title, affiliateLink },
  });
}

export async function wasGeneratedToday(mlItemId: string): Promise<boolean> {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const row = await prisma.mercadoLivreGeneratedLink.findFirst({
    where: { mlItemId, generatedAt: { gte: startOfToday } },
  });

  return row !== null;
}

export async function findGeneratedTodayMap(mlItemIds: string[]): Promise<Map<string, string>> {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const rows = await prisma.mercadoLivreGeneratedLink.findMany({
    where: { mlItemId: { in: mlItemIds }, generatedAt: { gte: startOfToday } },
    orderBy: { generatedAt: "desc" },
    select: { mlItemId: true, affiliateLink: true },
  });

  const map = new Map<string, string>();
  for (const row of rows) {
    if (!map.has(row.mlItemId)) {
      map.set(row.mlItemId, row.affiliateLink);
    }
  }
  return map;
}
