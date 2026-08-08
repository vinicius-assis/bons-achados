import type { MLHubSession } from "@/lib/mercadolivre/session";
import { MercadoLivreSessionExpiredError, BROWSER_LIKE_HEADERS } from "@/lib/mercadolivre/hubClient";

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
      ...BROWSER_LIKE_HEADERS,
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
    console.error(`Mercado Livre createLink rejected the session: HTTP ${response.status}`);
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
