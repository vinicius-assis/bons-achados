import type { MLHubSession } from "@/lib/mercadolivre/session";

const HUB_SEARCH_URL =
  "https://www.mercadolivre.com.br/affiliate-program/api/hub/search?is_affiliate=true&device=desktop";

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
}

export async function searchAffiliateProducts(
  query: string,
  session: MLHubSession
): Promise<MLHubItem[]> {
  const response = await fetch(HUB_SEARCH_URL, {
    method: "POST",
    headers: {
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
      offset: 0,
    }),
  });

  if (response.status === 401 || response.status === 403) {
    throw new MercadoLivreSessionExpiredError();
  }
  if (!response.ok) {
    throw new Error(`Mercado Livre hub search failed: ${response.status}`);
  }

  const data = await response.json();
  const cards = data?.polycard_client_model?.polycards;
  if (!Array.isArray(cards)) {
    throw new MercadoLivreSessionExpiredError();
  }

  return cards
    .map(parseCard)
    .filter((item): item is MLHubItem => item !== null);
}
