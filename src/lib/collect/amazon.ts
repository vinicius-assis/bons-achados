import { fetchAccessToken, searchItems, AmazonCreatorsApiError, type AmazonDealItem } from "@/lib/amazon/creatorsApiClient";
import { persistItems } from "@/lib/collect/persist";
import { pickRandomSearchTerm } from "@/lib/collect/searchTerms";
import type { CollectItem, CollectResult } from "@/lib/collect/types";

const TARGET_ITEM_COUNT = 50;
const ITEMS_PER_PAGE = 10;
const MAX_PAGES = 5;

function mapAmazonItems(items: AmazonDealItem[]): CollectItem[] {
  return items.map((item) => ({
    productId: item.asin,
    title: item.title,
    affiliateLink: item.affiliateLink,
    image: item.image,
    price: item.price,
    oldPrice: item.oldPrice,
    discount: item.discount,
  }));
}

export async function collectAmazon(): Promise<CollectResult> {
  const searchTerm = pickRandomSearchTerm();

  try {
    const token = await fetchAccessToken();

    const fetched: AmazonDealItem[] = [];
    for (let page = 1; page <= MAX_PAGES && fetched.length < TARGET_ITEM_COUNT; page++) {
      const pageItems = await searchItems(searchTerm, page, token);
      fetched.push(...pageItems);
      if (pageItems.length < ITEMS_PER_PAGE) {
        break;
      }
    }
    const items = fetched.slice(0, TARGET_ITEM_COUNT);

    if (items.length === 0) {
      return { attempted: 0, inserted: 0, skipped: 0 };
    }

    const mapped = mapAmazonItems(items);
    const { inserted, skipped } = await persistItems("AMAZON", mapped);
    return { attempted: items.length, inserted, skipped };
  } catch (error) {
    if (error instanceof AmazonCreatorsApiError && error.rateLimited) {
      return { attempted: 0, inserted: 0, skipped: 0, error: "rate_limited" };
    }
    console.error("collectAmazon failed:", error);
    return { attempted: 0, inserted: 0, skipped: 0, error: "collect_failed" };
  }
}
