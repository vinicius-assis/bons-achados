import { getSession } from "@/lib/amazon/session";
import { listDeals, AmazonSessionExpiredError, type AmazonDealItem } from "@/lib/amazon/hubClient";
import { parseDiscountPercentage } from "@/lib/mercadolivre/discountLabel";
import { persistItems } from "@/lib/collect/persist";
import type { CollectItem, CollectResult } from "@/lib/collect/types";

const TARGET_ITEM_COUNT = 50;

export function mapAmazonItems(items: AmazonDealItem[]): CollectItem[] {
  return items.map((item) => ({
    productId: item.asin,
    title: item.title,
    affiliateLink: item.affiliateLink,
    image: item.image,
    price: item.price,
    oldPrice: item.oldPrice,
    discount: parseDiscountPercentage(item.discountLabel),
  }));
}

export async function collectAmazon(): Promise<CollectResult> {
  const session = await getSession();
  if (!session) {
    return { attempted: 0, inserted: 0, skipped: 0, error: "no_session" };
  }

  try {
    const fetched: AmazonDealItem[] = [];
    let offset = 0;
    let nextIndex: number | null = 0;
    while (fetched.length < TARGET_ITEM_COUNT && nextIndex !== null) {
      const page = await listDeals(offset, session);
      if (page.items.length === 0) {
        break;
      }
      fetched.push(...page.items);
      nextIndex = page.nextIndex;
      offset = page.nextIndex ?? offset;
    }
    const items = fetched.slice(0, TARGET_ITEM_COUNT);

    if (items.length === 0) {
      return { attempted: 0, inserted: 0, skipped: 0 };
    }

    const mapped = mapAmazonItems(items);
    const { inserted, skipped } = await persistItems("AMAZON", mapped);
    return { attempted: items.length, inserted, skipped };
  } catch (error) {
    if (error instanceof AmazonSessionExpiredError) {
      return { attempted: 0, inserted: 0, skipped: 0, error: "session_expired" };
    }
    console.error("collectAmazon failed:", error);
    return { attempted: 0, inserted: 0, skipped: 0, error: "collect_failed" };
  }
}
