import type { AmazonDealItem } from "@/lib/amazon/creatorsApiClient";

// Amazon's storefront "Deals" feed (the same private JSON endpoint the
// amazon.com.br/deals page calls). It needs the logged-in Associates session
// cookie, unlike the Creators API, and it does NOT return affiliate links, so
// we build them ourselves from the ASIN + AMAZON_AFFILIATE_TAG.
const SEARCH_URL = "https://www.amazon.com.br/d2b/api/v1/products/search";
const REFERER = "https://www.amazon.com.br/deals?ref_=nav_cs_gb";
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36";
const REQUEST_TIMEOUT_MS = 10_000;
const MIN_REQUEST_INTERVAL_MS = 3000;

export const DEALS_PAGE_SIZE = 30;

let lastRequestAt = 0;

async function paceRequest(): Promise<void> {
  const waitMs = lastRequestAt + MIN_REQUEST_INTERVAL_MS - Date.now();
  if (waitMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  lastRequestAt = Date.now();
}

// Test-only: resets the module-level pacer state.
export function __resetDealsWebPacerForTests(): void {
  lastRequestAt = 0;
}

export class AmazonWebSessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AmazonWebSessionError";
  }
}

export function buildAffiliateLink(asin: string, tag: string): string {
  return `https://www.amazon.com.br/dp/${asin}?tag=${encodeURIComponent(tag)}`;
}

function parsePrice(raw: unknown): number | null {
  const value = typeof raw === "string" ? Number(raw) : raw;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseDiscount(product: any, price: number, oldPrice: number | null): number | null {
  if (oldPrice !== null && oldPrice > price) {
    return Math.round((1 - price / oldPrice) * 100);
  }
  // No strikethrough price: fall back to the "NN% off" badge when there is one.
  const badgeText = product.dealBadge?.label?.content?.fragments?.[0]?.text;
  const match = typeof badgeText === "string" ? /(\d+)\s*%\s*off/i.exec(badgeText) : null;
  return match ? Number(match[1]) : null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseDealsProduct(product: any, tag: string): AmazonDealItem | null {
  try {
    const asin = product?.asin;
    const title = product?.title;
    if (typeof asin !== "string" || !/^[A-Z0-9]{10}$/.test(asin) || typeof title !== "string" || !title) {
      return null;
    }
    if (product.dealDetails?.state !== "AVAILABLE") {
      return null;
    }
    const price = parsePrice(product.price?.priceToPay?.price);
    if (price === null) {
      return null;
    }
    const oldPrice = parsePrice(product.price?.basisPrice?.price);
    const imageAsset = product.image?.hiRes ?? product.image?.lowRes;
    return {
      asin,
      title,
      price,
      oldPrice,
      discount: parseDiscount(product, price, oldPrice),
      image: imageAsset?.baseUrl && imageAsset?.extension ? `${imageAsset.baseUrl}.${imageAsset.extension}` : "",
      affiliateLink: buildAffiliateLink(asin, tag),
    };
  } catch {
    return null;
  }
}

export type DealsPage = { items: AmazonDealItem[]; nextIndex: number | null };

export async function fetchDealsPage(startIndex: number, cookie: string): Promise<DealsPage> {
  const tag = process.env.AMAZON_AFFILIATE_TAG;
  if (!tag) {
    throw new Error("AMAZON_AFFILIATE_TAG is not set");
  }

  const params = new URLSearchParams({
    pageSize: String(DEALS_PAGE_SIZE),
    startIndex: String(startIndex),
    calculateRefinements: "false",
    rankingContext: JSON.stringify({ pageTypeId: "deals", rankGroup: "PARENT_ASIN_RANKING" }),
    filters: JSON.stringify({
      includedDepartments: [],
      excludedDepartments: [],
      includedTags: [],
      excludedTags: [],
      promotionTypes: ["LIGHTNING_DEAL", "BEST_DEAL"],
      accessTypes: [],
      brandIds: [],
      unifiedIds: [],
    }),
  });

  await paceRequest();
  const response = await fetch(`${SEARCH_URL}?${params.toString()}`, {
    headers: {
      accept: "*/*",
      "accept-language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
      cookie,
      referer: REFERER,
      "user-agent": USER_AGENT,
      // Without these browser fingerprint headers the endpoint answers 503
      // (anti-bot) even with a valid session cookie.
      "sec-ch-ua": '"Chromium";v="152", "Not?A_Brand";v="24", "Google Chrome";v="152"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Linux"',
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-origin",
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (response.status === 401 || response.status === 403) {
    throw new AmazonWebSessionError(`Amazon deals request rejected: ${response.status}`);
  }
  if (!response.ok) {
    throw new Error(`Amazon deals request failed: ${response.status}`);
  }
  // An expired session usually redirects to a login/captcha HTML page with a 200.
  if (!response.headers.get("content-type")?.includes("json")) {
    throw new AmazonWebSessionError("Amazon deals response was not JSON (session expired or captcha)");
  }

  const data = await response.json();
  const products = Array.isArray(data?.products) ? data.products : [];
  const items = products
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((product: any) => parseDealsProduct(product, tag))
    .filter((item: AmazonDealItem | null): item is AmazonDealItem => item !== null);
  const nextIndex = typeof data?.nextIndex === "number" && products.length > 0 ? data.nextIndex : null;
  return { items, nextIndex };
}
