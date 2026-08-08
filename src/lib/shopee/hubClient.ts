import { shopeeRequest } from "@/lib/shopee/client";

const SEARCH_QUERY = `
  query SearchOffers($keyword: String!, $page: Int!) {
    productOfferV2(keyword: $keyword, sortType: 1, page: $page, limit: 20) {
      nodes {
        itemId
        commissionRate
        priceMin
        priceDiscountRate
        imageUrl
        offerLink
        productLink
        productName
        shopName
        ratingStar
      }
      pageInfo {
        hasNextPage
      }
    }
  }
`;

export type ShopeeHubItem = {
  itemId: string;
  title: string;
  price: number;
  discount: number | null;
  image: string;
  affiliateLink: string;
  productLink: string;
  shopName: string;
  commissionRate: string | null;
  ratingStar: number | null;
};

type RawNode = {
  itemId?: number | string;
  commissionRate?: string;
  priceMin?: string;
  priceDiscountRate?: number;
  imageUrl?: string;
  offerLink?: string;
  productLink?: string;
  productName?: string;
  shopName?: string;
  ratingStar?: string;
};

type SearchResponse = {
  productOfferV2: {
    nodes: RawNode[];
    pageInfo: { hasNextPage: boolean };
  };
};

function parseNode(node: RawNode): ShopeeHubItem | null {
  try {
    if (!node.itemId || !node.productName || !node.offerLink || !node.imageUrl) {
      return null;
    }
    const price = Number(node.priceMin);
    if (!Number.isFinite(price) || price <= 0) {
      return null;
    }
    const discount = node.priceDiscountRate && node.priceDiscountRate > 0 ? node.priceDiscountRate : null;
    const ratingStar = node.ratingStar !== undefined ? parseFloat(node.ratingStar) : null;

    return {
      itemId: String(node.itemId),
      title: node.productName,
      price,
      discount,
      image: node.imageUrl ?? "",
      affiliateLink: node.offerLink,
      productLink: node.productLink ?? "",
      shopName: node.shopName ?? "",
      commissionRate: node.commissionRate ?? null,
      ratingStar: ratingStar !== null && !Number.isNaN(ratingStar) ? ratingStar : null,
    };
  } catch {
    return null;
  }
}

export async function searchProducts(
  keyword: string,
  page: number
): Promise<{ items: ShopeeHubItem[]; hasNextPage: boolean }> {
  const trimmedKeyword = keyword.trim();
  if (!trimmedKeyword) {
    return { items: [], hasNextPage: false };
  }

  const response = await shopeeRequest<SearchResponse>(SEARCH_QUERY, {
    keyword: trimmedKeyword,
    page,
  });

  const items = response.productOfferV2.nodes
    .map(parseNode)
    .filter((item): item is ShopeeHubItem => item !== null);

  return { items, hasNextPage: response.productOfferV2.pageInfo.hasNextPage };
}
