import type { AmazonHubSession } from "@/lib/amazon/session";

const BASE_URL = "https://www.amazon.com.br/d2b/api/v1/products/search";
const PAGE_SIZE = 30;

const RANKING_CONTEXT = JSON.stringify({
  pageTypeId: "ofertasmensais",
  rankGroup: "PARENT_ASIN_RANKING",
});

const FILTERS = JSON.stringify({
  includedDepartments: [],
  excludedDepartments: [],
  includedTags: [],
  excludedTags: ["restrictedcontent", "duplicatedeal", "TFSRestricted3P", "DealOMatic"],
  promotionTypes: ["LIGHTNING_DEAL", "BEST_DEAL"],
  accessTypes: [],
  brandIds: [],
  unifiedIds: [],
});

const PINNED_PROMOTION_GROUPS = JSON.stringify([["B0CCJXT8VG"]]);

// Amazon's deals page is an internal, browser-only endpoint. Called from a
// serverless function without a real browser fingerprint, it can be treated
// as bot traffic without these headers even when the session cookies
// themselves are perfectly valid — same reasoning as Mercado Livre's client.
export const BROWSER_LIKE_HEADERS = {
  "user-agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "sec-ch-ua": '"Chromium";v="131", "Not_A Brand";v="24", "Google Chrome";v="131"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Linux"',
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-origin",
} as const;

export type AmazonDealItem = {
  asin: string;
  title: string;
  price: number;
  oldPrice: number | null;
  discountLabel: string | null;
  image: string;
  permalink: string;
  affiliateLink: string;
};

export class AmazonSessionExpiredError extends Error {
  constructor() {
    super("Amazon session expired or invalid");
    this.name = "AmazonSessionExpiredError";
  }
}

type AmazonPicture = { baseUrl: string; extension: string };

function buildImageUrl(picture: AmazonPicture | undefined): string {
  if (!picture?.baseUrl || !picture.extension) {
    return "";
  }
  return `${picture.baseUrl}.${picture.extension}`;
}

function buildPermalink(link: string | undefined, asin: string): string {
  const path = typeof link === "string" && link.length > 0 ? link : `/dp/${asin}`;
  return path.startsWith("http") ? path : `https://www.amazon.com.br${path}`;
}

function buildAffiliateLink(asin: string, tag: string): string {
  return `https://www.amazon.com.br/dp/${asin}?tag=${tag}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseProduct(product: any, tag: string): AmazonDealItem | null {
  try {
    const asin = product.asin;
    const title = product.title;
    const priceToPay = product.price?.priceToPay?.price;
    if (!asin || !title || priceToPay === undefined) {
      return null;
    }

    const price = parseFloat(priceToPay);
    if (Number.isNaN(price)) {
      return null;
    }

    const rawOldPrice = product.price?.basisPrice?.price;
    const oldPrice = rawOldPrice !== undefined ? parseFloat(rawOldPrice) : null;

    return {
      asin,
      title,
      price,
      oldPrice: oldPrice !== null && !Number.isNaN(oldPrice) ? oldPrice : null,
      discountLabel: product.dealBadge?.label?.content?.fragments?.[0]?.text ?? null,
      image: buildImageUrl(product.image?.hiRes ?? product.image?.lowRes),
      permalink: buildPermalink(product.link, asin),
      affiliateLink: buildAffiliateLink(asin, tag),
    };
  } catch {
    return null;
  }
}

export async function listDeals(
  offset: number,
  session: AmazonHubSession
): Promise<{ items: AmazonDealItem[]; nextIndex: number | null }> {
  const tag = process.env.AMAZON_AFFILIATE_TAG ?? "";
  const params = new URLSearchParams({
    pageSize: String(PAGE_SIZE),
    startIndex: String(offset),
    calculateRefinements: "false",
    rankingContext: RANKING_CONTEXT,
    filters: FILTERS,
    pinnedPromotionGroups: PINNED_PROMOTION_GROUPS,
    pinnedPromotionsLayoutGroup: "6do6",
  });

  const response = await fetch(`${BASE_URL}?${params.toString()}`, {
    method: "GET",
    headers: {
      ...BROWSER_LIKE_HEADERS,
      accept: "*/*",
      referer: "https://www.amazon.com.br/events/ofertasmensais",
      cookie: session.cookieHeader,
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (response.status === 401 || response.status === 403) {
    console.error(`Amazon deals search rejected the session: HTTP ${response.status}`);
    throw new AmazonSessionExpiredError();
  }
  if (!response.ok) {
    throw new Error(`Amazon deals search failed: ${response.status}`);
  }

  const data = await response.json();
  if (data == null || typeof data !== "object" || !Array.isArray((data as { products?: unknown }).products)) {
    console.error(
      "Amazon deals search returned an unexpected body shape:",
      JSON.stringify(data).slice(0, 500)
    );
    throw new AmazonSessionExpiredError();
  }

  const products = (data as { products: unknown[] }).products;
  const items = products
    .map((product) => parseProduct(product, tag))
    .filter((item): item is AmazonDealItem => item !== null);

  const rawNextIndex = (data as { nextIndex?: unknown }).nextIndex;
  const nextIndex = typeof rawNextIndex === "number" ? rawNextIndex : null;

  return { items, nextIndex };
}
