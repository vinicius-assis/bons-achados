import { searchProducts, type ShopeeHubItem } from "@/lib/shopee/hubClient";
import { persistItems } from "@/lib/collect/persist";
import { pickRandomSearchTerm } from "@/lib/collect/searchTerms";
import type { CollectItem, CollectResult } from "@/lib/collect/types";

const TARGET_ITEM_COUNT = 50;

export function mapShopeeItems(items: ShopeeHubItem[]): CollectItem[] {
  return items.map((item) => ({
    productId: item.itemId,
    title: item.title,
    affiliateLink: item.affiliateLink,
    image: item.image,
    price: item.price,
    oldPrice: null,
    discount: item.discount,
  }));
}

export async function collectShopee(term?: string): Promise<CollectResult> {
  const searchTerm = term ?? pickRandomSearchTerm();

  try {
    const fetched: ShopeeHubItem[] = [];
    let page = 1;
    while (fetched.length < TARGET_ITEM_COUNT) {
      const result = await searchProducts(searchTerm, page);
      if (result.items.length === 0) {
        break;
      }
      fetched.push(...result.items);
      if (!result.hasNextPage) {
        break;
      }
      page += 1;
    }
    const items = fetched.slice(0, TARGET_ITEM_COUNT);

    if (items.length === 0) {
      return { attempted: 0, inserted: 0, skipped: 0 };
    }

    const mapped = mapShopeeItems(items);
    const { inserted, skipped } = await persistItems("SHOPEE", mapped);
    return { attempted: items.length, inserted, skipped };
  } catch (error) {
    console.error("collectShopee failed:", error);
    return { attempted: 0, inserted: 0, skipped: 0, error: "collect_failed" };
  }
}
