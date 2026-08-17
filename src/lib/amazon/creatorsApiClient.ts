const TOKEN_URL = "https://api.amazon.com/auth/o2/token";
const API_BASE_URL = "https://creatorsapi.amazon";
const MARKETPLACE = "www.amazon.com.br";
const REQUEST_TIMEOUT_MS = 10_000;

export class AmazonCreatorsApiError extends Error {
  rateLimited: boolean;
  constructor(message: string, rateLimited = false) {
    super(message);
    this.name = "AmazonCreatorsApiError";
    this.rateLimited = rateLimited;
  }
}

export async function fetchAccessToken(): Promise<string> {
  const clientId = process.env.AMAZON_CREATORS_CLIENT_ID;
  const clientSecret = process.env.AMAZON_CREATORS_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("AMAZON_CREATORS_CLIENT_ID/SECRET is not set");
  }

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: "creatorsapi::default",
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new AmazonCreatorsApiError(`Amazon token request failed: ${response.status}`);
  }

  const data = await response.json();
  if (typeof data?.access_token !== "string") {
    throw new AmazonCreatorsApiError("Amazon token response missing access_token");
  }
  return data.access_token;
}

export type AmazonDealItem = {
  asin: string;
  title: string;
  price: number;
  oldPrice: number | null;
  discount: number | null;
  image: string;
  affiliateLink: string;
};

export type AmazonSearchFilters = {
  searchIndex?: string;
  sortBy?: string;
  brand?: string;
  minPrice?: number;
  maxPrice?: number;
  prime?: boolean;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseProduct(product: any): AmazonDealItem | null {
  try {
    const asin = product.asin;
    const title = product.itemInfo?.title?.displayValue;
    const detailPageURL = product.detailPageURL;
    const listing = product.offersV2?.listings?.[0];
    const price = listing?.price?.money?.amount;
    if (!asin || !title || !detailPageURL || typeof price !== "number") {
      return null;
    }
    const rawOldPrice = listing?.price?.savingBasis?.money?.amount;
    const rawDiscount = listing?.price?.savings?.percentage;
    return {
      asin,
      title,
      price,
      oldPrice: typeof rawOldPrice === "number" ? rawOldPrice : null,
      discount: typeof rawDiscount === "number" ? rawDiscount : null,
      image: product.images?.primary?.medium?.url ?? "",
      affiliateLink: detailPageURL,
    };
  } catch {
    return null;
  }
}

function requirePartnerTag(): string {
  const partnerTag = process.env.AMAZON_AFFILIATE_TAG;
  if (!partnerTag) {
    throw new Error("AMAZON_AFFILIATE_TAG is not set");
  }
  return partnerTag;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function callCreatorsApi(path: string, body: Record<string, unknown>, token: string): Promise<any> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      "x-marketplace": MARKETPLACE,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (response.status === 429) {
    throw new AmazonCreatorsApiError("Amazon Creators API rate limited", true);
  }
  if (!response.ok) {
    throw new AmazonCreatorsApiError(`Amazon Creators API request failed: ${response.status}`);
  }
  return response.json();
}

export async function searchItems(
  keywords: string,
  page: number,
  token: string,
  filters: AmazonSearchFilters = {}
): Promise<AmazonDealItem[]> {
  const partnerTag = requirePartnerTag();
  const body: Record<string, unknown> = {
    keywords,
    partnerTag,
    marketplace: MARKETPLACE,
    itemPage: page,
    itemCount: 10,
    resources: ["images.primary.medium", "itemInfo.title", "offersV2.listings.price"],
  };
  if (filters.searchIndex) body.searchIndex = filters.searchIndex;
  if (filters.sortBy) body.sortBy = filters.sortBy;
  if (filters.brand) body.brand = filters.brand;
  if (filters.minPrice !== undefined) body.minPrice = filters.minPrice;
  if (filters.maxPrice !== undefined) body.maxPrice = filters.maxPrice;
  if (filters.prime) body.deliveryFlags = ["Prime"];

  const data = await callCreatorsApi("/catalog/v1/searchItems", body, token);
  const products = data?.searchResult?.items;
  if (!Array.isArray(products)) {
    return [];
  }
  return products.map(parseProduct).filter((item: AmazonDealItem | null): item is AmazonDealItem => item !== null);
}

export async function getItems(asins: string[], token: string): Promise<AmazonDealItem[]> {
  const partnerTag = requirePartnerTag();
  const body = {
    itemIds: asins,
    itemIdType: "ASIN",
    partnerTag,
    marketplace: MARKETPLACE,
    resources: ["itemInfo.title", "offersV2.listings.price"],
  };
  const data = await callCreatorsApi("/catalog/v1/getItems", body, token);
  const products = data?.itemResults?.items;
  if (!Array.isArray(products)) {
    return [];
  }
  return products.map(parseProduct).filter((item: AmazonDealItem | null): item is AmazonDealItem => item !== null);
}
