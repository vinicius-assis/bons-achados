import type { MLHubSession } from "@/lib/mercadolivre/session";

const HUB_SEARCH_URL =
  "https://www.mercadolivre.com.br/affiliate-program/api/hub/search?is_affiliate=true&device=desktop";

// Mercado Livre's affiliate hub is an internal, browser-only endpoint. Called
// from a serverless function (no real browser fingerprint, a datacenter IP),
// it can be treated as bot traffic without these headers even when the
// session cookies themselves are perfectly valid.
export const BROWSER_LIKE_HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "sec-ch-ua": '"Chromium";v="131", "Not_A Brand";v="24", "Google Chrome";v="131"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-origin",
} as const;

export type MLHubItem = {
  itemId: string;
  title: string;
  price: number;
  oldPrice: number | null;
  discountLabel: string | null;
  rating: number | null;
  soldLabel: string | null;
  image: string;
  permalink: string;
  commissionLabel: string | null;
};

export class MercadoLivreSessionExpiredError extends Error {
  constructor() {
    super("Mercado Livre session expired or invalid");
    this.name = "MercadoLivreSessionExpiredError";
  }
}

type PolycardComponent = {
  type: string;
  [key: string]: unknown;
};

function findComponent(
  components: PolycardComponent[],
  type: string
): PolycardComponent | undefined {
  return components.find((component) => component.type === type);
}

function buildImageUrl(pictureId: string | undefined): string {
  if (!pictureId) {
    return "";
  }
  return `https://http2.mlstatic.com/D_Q_NP_2X_${pictureId}-AB.webp`;
}

function buildPermalink(url: string, urlParams: string | undefined): string {
  const base = url.startsWith("http") ? url : `https://${url}`;
  return urlParams ? `${base}${urlParams}` : base;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseCard(card: any): MLHubItem | null {
  try {
    const components: PolycardComponent[] = card.components ?? [];
    const titleComponent = findComponent(components, "title");
    const priceComponent = findComponent(components, "price");
    if (!titleComponent || !priceComponent || !card.metadata?.id) {
      return null;
    }

    const reviewComponent = findComponent(components, "review_compacted");
    const chipComponent = findComponent(components, "chip");

    let rating: number | null = null;
    let soldLabel: string | null = null;
    if (reviewComponent) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const values: any[] = (reviewComponent as any).review_compacted?.values ?? [];
      const ratingValue = values.find((value) => value.key === "label");
      const soldValue = values.find((value) => value.key === "label2");
      rating = ratingValue?.label?.text ? parseFloat(ratingValue.label.text) : null;
      soldLabel = soldValue?.label?.text ? soldValue.label.text.replace(/^\|\s*/, "") : null;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const price = (priceComponent as any).price;
    const pictureId = card.pictures?.pictures?.[0]?.id;

    return {
      itemId: card.metadata.id,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      title: (titleComponent as any).title.text,
      price: price.current_price.value,
      oldPrice: price.previous_price?.value ?? null,
      discountLabel: price.discount_label?.text ?? null,
      rating,
      soldLabel,
      image: buildImageUrl(pictureId),
      permalink: buildPermalink(card.metadata.url, card.metadata.url_params),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      commissionLabel: (chipComponent as any)?.chip?.label?.text ?? null,
    };
  } catch {
    return null;
  }
}

export async function searchAffiliateProducts(
  query: string,
  session: MLHubSession,
  offset: number = 0
): Promise<MLHubItem[]> {
  const response = await fetch(HUB_SEARCH_URL, {
    method: "POST",
    headers: {
      ...BROWSER_LIKE_HEADERS,
      "content-type": "application/json",
      accept: "application/json, text/plain, */*",
      origin: "https://www.mercadolivre.com.br",
      referer: "https://www.mercadolivre.com.br/afiliados/hub",
      cookie: session.cookieHeader,
      "x-csrf-token": session.csrfToken,
    },
    body: JSON.stringify({
      search: query,
      sort: "relevance",
      filters: [{ id: "best_seller", value: true }],
      offset,
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (response.status === 401 || response.status === 403) {
    console.error(
      `Mercado Livre hub search rejected the session: HTTP ${response.status}`
    );
    throw new MercadoLivreSessionExpiredError();
  }
  if (!response.ok) {
    throw new Error(`Mercado Livre hub search failed: ${response.status}`);
  }

  const data = await response.json();
  if (data == null || typeof data !== "object" || !("polycard_client_model" in data)) {
    console.error(
      "Mercado Livre hub search returned an unexpected body shape:",
      JSON.stringify(data).slice(0, 500)
    );
    throw new MercadoLivreSessionExpiredError();
  }

  const cards = (data as { polycard_client_model?: { polycards?: unknown } })
    .polycard_client_model?.polycards;
  if (!Array.isArray(cards)) {
    return [];
  }

  return cards
    .map(parseCard)
    .filter((item): item is MLHubItem => item !== null);
}
